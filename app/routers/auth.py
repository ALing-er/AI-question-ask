"""认证相关接口：注册 / 登录 / 登出 / 当前用户 / 改密码。"""
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.deps import CurrentUser, TokenContext
from app.core.errors import AppError
from app.core.logging_setup import get_logger
from app.core.security import create_access_token, hash_password, verify_password
from app.db import get_session
from app.db.models import RevokedToken, User
from app.schemas import (
    ChangePasswordRequest,
    LoginRequest,
    RegisterRequest,
    TokenResponse,
    UserOut,
)
from app.services.audit import write_audit

router = APIRouter(prefix="/api/auth", tags=["auth"])
logger = get_logger("app.auth")


def _issue_token(user: User) -> TokenResponse:
    token, expires_at = create_access_token(
        user_id=user.id, role=user.role, token_version=user.token_version
    )
    return TokenResponse(
        access_token=token,
        expires_at=expires_at,
        user=UserOut.model_validate(user),
    )


@router.post("/register", response_model=TokenResponse, status_code=201, summary="注册")
async def register(
    payload: RegisterRequest,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> TokenResponse:
    settings = get_settings()
    if not settings.allow_registration:
        raise AppError("AUTH_FORBIDDEN", "当前已关闭注册")

    if await session.scalar(select(User).where(User.username == payload.username)):
        raise AppError("USER_USERNAME_TAKEN")

    user = User(
        username=payload.username,
        password_hash=hash_password(payload.password),
        nickname=payload.nickname or payload.username,
        role="user",
        status="active",
    )
    session.add(user)
    try:
        await session.commit()
    except IntegrityError:
        # 唯一索引兜底：并发注册同名时上面的查询可能都没查到
        await session.rollback()
        raise AppError("USER_USERNAME_TAKEN") from None

    await session.refresh(user)
    write_audit(
        session,
        actor=user,
        action="user.register",
        target_type="user",
        target_id=user.id,
        request=request,
    )
    await session.commit()
    logger.info("用户注册", extra={"event": "user_register", "username": user.username})
    return _issue_token(user)


@router.post("/login", response_model=TokenResponse, summary="登录")
async def login(
    payload: LoginRequest,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> TokenResponse:
    settings = get_settings()
    user = await session.scalar(select(User).where(User.username == payload.username))

    # 不区分"用户不存在"和"密码错误"，避免用户名枚举
    if user is None or user.deleted_at is not None:
        logger.warning(
            "登录失败：用户不存在", extra={"event": "login_failed", "username": payload.username}
        )
        raise AppError("AUTH_INVALID_CREDENTIALS")

    now = datetime.now(timezone.utc)
    if user.locked_until is not None and user.locked_until > now:
        remaining = max(1, int((user.locked_until - now).total_seconds() // 60) + 1)
        raise AppError(
            "AUTH_LOGIN_LOCKED", f"登录失败次数过多，请 {remaining} 分钟后再试"
        )

    # 锁定已过期，重置计数
    if user.locked_until is not None and user.locked_until <= now:
        user.locked_until = None
        user.failed_login_attempts = 0

    if not verify_password(payload.password, user.password_hash):
        user.failed_login_attempts += 1
        if user.failed_login_attempts >= settings.login_max_attempts:
            user.locked_until = now + timedelta(minutes=settings.login_lock_minutes)
            await session.commit()
            logger.warning(
                "登录失败：账号临时锁定",
                extra={
                    "event": "login_locked",
                    "username": payload.username,
                    "minutes": settings.login_lock_minutes,
                },
            )
            raise AppError(
                "AUTH_LOGIN_LOCKED",
                f"登录失败次数过多，账号已锁定 {settings.login_lock_minutes} 分钟",
            )

        await session.commit()
        logger.warning(
            "登录失败：密码错误", extra={"event": "login_failed", "username": payload.username}
        )
        raise AppError("AUTH_INVALID_CREDENTIALS")

    if user.status != "active":
        logger.warning(
            "登录失败：账号停用", extra={"event": "login_failed", "username": payload.username}
        )
        raise AppError("AUTH_USER_DISABLED")

    user.failed_login_attempts = 0
    user.locked_until = None
    user.last_login_at = now
    write_audit(
        session,
        actor=user,
        action="user.login",
        target_type="user",
        target_id=user.id,
        request=request,
    )
    await session.commit()
    await session.refresh(user)

    logger.info("登录成功", extra={"event": "login_success", "username": user.username})
    return _issue_token(user)


@router.post("/logout", summary="登出")
async def logout(
    ctx: TokenContext,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> dict:
    """把当前 token 的 jti 写入黑名单，立即失效；其他设备不受影响。"""
    jti = ctx.payload.get("jti")
    exp = ctx.payload.get("exp")
    if jti and exp:
        exists = await session.scalar(
            select(RevokedToken.id).where(RevokedToken.jti == str(jti))
        )
        if exists is None:
            session.add(
                RevokedToken(
                    jti=str(jti),
                    expires_at=datetime.fromtimestamp(int(exp), tz=timezone.utc),
                )
            )

    write_audit(
        session,
        actor=ctx.user,
        action="user.logout",
        target_type="user",
        target_id=ctx.user.id,
        request=request,
    )
    await session.commit()
    logger.info("用户登出", extra={"event": "logout", "username": ctx.user.username})
    return {"ok": True}


@router.get("/me", response_model=UserOut, summary="当前用户")
async def me(user: CurrentUser) -> UserOut:
    return UserOut.model_validate(user)


@router.patch("/password", response_model=TokenResponse, summary="修改自己的密码")
async def change_password(
    payload: ChangePasswordRequest,
    request: Request,
    user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> TokenResponse:
    if not verify_password(payload.old_password, user.password_hash):
        raise AppError("AUTH_INVALID_CREDENTIALS", "原密码不正确")

    user.password_hash = hash_password(payload.new_password)
    # 密码变更后让其他设备上的登录态全部失效
    user.token_version += 1
    user.failed_login_attempts = 0
    user.locked_until = None
    write_audit(
        session,
        actor=user,
        action="user.password_change",
        target_type="user",
        target_id=user.id,
        request=request,
    )
    await session.commit()
    await session.refresh(user)

    logger.info("修改密码", extra={"event": "password_changed", "username": user.username})
    return _issue_token(user)
