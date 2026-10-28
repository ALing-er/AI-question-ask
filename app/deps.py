"""公共依赖：鉴权、权限、资源归属校验。

隔离红线都在这里：
- 身份只从 JWT 的 sub 取，绝不信任请求体里的 user_id
- 别人的资源一律 404（不是 403，避免泄露"存在但无权"）
"""
from dataclasses import dataclass
from typing import Annotated, Any

import jwt
from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.errors import AppError
from app.logging_config import user_id_ctx
from app.models import Conversation, RevokedToken, User
from app.security import decode_access_token

bearer_scheme = HTTPBearer(auto_error=False)


@dataclass
class AuthContext:
    user: User
    payload: dict[str, Any]


async def get_auth_context(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> AuthContext:
    if credentials is None or not credentials.credentials:
        raise AppError("AUTH_TOKEN_MISSING")

    try:
        payload = decode_access_token(credentials.credentials)
    except jwt.ExpiredSignatureError:
        raise AppError("AUTH_TOKEN_EXPIRED") from None
    except jwt.InvalidTokenError:
        raise AppError("AUTH_TOKEN_INVALID") from None

    try:
        user_id = int(payload.get("sub", ""))
    except (TypeError, ValueError):
        raise AppError("AUTH_TOKEN_INVALID") from None

    # 登出黑名单：只撤销当前 token，不影响同一用户的其他设备
    jti = payload.get("jti")
    if jti:
        revoked = await session.scalar(
            select(RevokedToken.id).where(RevokedToken.jti == str(jti))
        )
        if revoked is not None:
            raise AppError("AUTH_TOKEN_REVOKED")

    user = await session.get(User, user_id)
    if user is None or user.deleted_at is not None:
        raise AppError("AUTH_TOKEN_INVALID")
    if user.status != "active":
        raise AppError("AUTH_USER_DISABLED")

    # 管理员禁用用户时会 +1，旧 token 立即失效
    if int(payload.get("ver", -1)) != int(user.token_version):
        raise AppError("AUTH_TOKEN_REVOKED")

    # 让后续日志自动带上 user_id
    user_id_ctx.set(str(user.id))
    return AuthContext(user=user, payload=payload)


async def get_current_user(ctx: Annotated[AuthContext, Depends(get_auth_context)]) -> User:
    return ctx.user


CurrentUser = Annotated[User, Depends(get_current_user)]
TokenContext = Annotated[AuthContext, Depends(get_auth_context)]


async def require_admin(user: CurrentUser) -> User:
    if user.role != "admin":
        raise AppError("AUTH_FORBIDDEN")
    return user


AdminUser = Annotated[User, Depends(require_admin)]


async def get_own_conversation(
    conversation_id: int,
    user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> Conversation:
    """按 id 取会话，但不是本人的一律 404。所有会话级接口都必须走它。"""
    conversation = await session.scalar(
        select(Conversation).where(
            Conversation.id == conversation_id,
            Conversation.user_id == user.id,
            Conversation.deleted_at.is_(None),
        )
    )
    if conversation is None:
        raise AppError("CONV_NOT_FOUND")
    return conversation


OwnConversation = Annotated[Conversation, Depends(get_own_conversation)]
