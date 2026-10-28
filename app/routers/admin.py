"""管理后台接口。

红线：
- 管理员只能管理账号状态，不能读取他人聊天内容
- 不能对自己执行禁用/删除/重置密码
- 禁用、重置密码、删除都会让 token_version +1，旧 token 立即失效
"""
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit import write_audit
from app.db import get_session
from app.deps import AdminUser
from app.errors import AppError
from app.logging_config import get_logger
from app.models import AuditLog, Conversation, Message, User
from app.schemas import (
    AdminResetPasswordRequest,
    AdminStats,
    AdminUserList,
    AdminUserOut,
    AdminUserUpdate,
    AuditLogList,
    AuditLogOut,
)
from app.security import hash_password

router = APIRouter(prefix="/api/admin", tags=["admin"])
logger = get_logger("app.admin")


def _user_out(user: User, conv_count: int = 0, msg_count: int = 0) -> AdminUserOut:
    base = AdminUserOut.model_validate(user)
    return base.model_copy(
        update={"conversation_count": conv_count, "message_count": msg_count}
    )


@router.get("/users", response_model=AdminUserList, summary="用户列表")
async def list_users(
    admin: AdminUser,
    session: Annotated[AsyncSession, Depends(get_session)],
    q: Annotated[str | None, Query(max_length=64)] = None,
    status: Annotated[str | None, Query(pattern="^(active|disabled)$")] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> AdminUserList:
    conditions = [User.deleted_at.is_(None)]
    if q and q.strip():
        like = f"%{q.strip()}%"
        conditions.append(or_(User.username.ilike(like), User.nickname.ilike(like)))
    if status:
        conditions.append(User.status == status)

    total = await session.scalar(
        select(func.count()).select_from(User).where(*conditions)
    )
    users = (
        await session.scalars(
            select(User)
            .where(*conditions)
            .order_by(User.id.asc())
            .limit(limit)
            .offset(offset)
        )
    ).all()

    conv_counts: dict[int, int] = {}
    msg_counts: dict[int, int] = {}
    user_ids = [u.id for u in users]
    if user_ids:
        conv_rows = await session.execute(
            select(Conversation.user_id, func.count(Conversation.id))
            .where(
                Conversation.user_id.in_(user_ids),
                Conversation.deleted_at.is_(None),
            )
            .group_by(Conversation.user_id)
        )
        conv_counts = {uid: count for uid, count in conv_rows.all()}

        msg_rows = await session.execute(
            select(Conversation.user_id, func.count(Message.id))
            .select_from(Conversation)
            .join(Message, Message.conversation_id == Conversation.id)
            .where(
                Conversation.user_id.in_(user_ids),
                Conversation.deleted_at.is_(None),
            )
            .group_by(Conversation.user_id)
        )
        msg_counts = {uid: count for uid, count in msg_rows.all()}

    items = [
        _user_out(u, conv_counts.get(u.id, 0), msg_counts.get(u.id, 0))
        for u in users
    ]
    return AdminUserList(items=items, total=int(total or 0))


@router.patch("/users/{user_id}", summary="启用 / 禁用用户")
async def update_user_status(
    user_id: int,
    payload: AdminUserUpdate,
    admin: AdminUser,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> dict:
    if payload.status is None:
        raise AppError("SYS_VALIDATION", "没有需要更新的字段")

    target = await session.get(User, user_id)
    if target is None or target.deleted_at is not None:
        raise AppError("USER_NOT_FOUND")
    if target.id == admin.id:
        raise AppError("ADMIN_SELF_FORBIDDEN", "不能修改自己的状态")

    previous = target.status
    target.status = payload.status
    if payload.status == "disabled":
        # 强制下线
        target.token_version += 1
        target.locked_until = None
    else:
        target.failed_login_attempts = 0
        target.locked_until = None

    write_audit(
        session,
        actor=admin,
        action="admin.user_status",
        target_type="user",
        target_id=target.id,
        detail={"from": previous, "to": payload.status},
        request=request,
    )
    await session.commit()
    logger.info(
        "管理员修改用户状态",
        extra={
            "event": "admin_user_status",
            "target": target.username,
            "status": payload.status,
        },
    )
    return {"ok": True, "status": target.status}


@router.post("/users/{user_id}/reset-password", summary="重置用户密码")
async def reset_password(
    user_id: int,
    payload: AdminResetPasswordRequest,
    admin: AdminUser,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> dict:
    target = await session.get(User, user_id)
    if target is None or target.deleted_at is not None:
        raise AppError("USER_NOT_FOUND")
    if target.id == admin.id:
        raise AppError("ADMIN_SELF_FORBIDDEN", "请通过修改密码接口修改自己的密码")

    target.password_hash = hash_password(payload.new_password)
    target.token_version += 1
    target.failed_login_attempts = 0
    target.locked_until = None

    write_audit(
        session,
        actor=admin,
        action="admin.user_reset_password",
        target_type="user",
        target_id=target.id,
        detail={"username": target.username},
        request=request,
    )
    await session.commit()
    logger.info(
        "管理员重置用户密码",
        extra={"event": "admin_user_reset_password", "target": target.username},
    )
    return {"ok": True}


@router.delete("/users/{user_id}", status_code=204, summary="删除用户（软删）")
async def delete_user(
    user_id: int,
    admin: AdminUser,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> Response:
    target = await session.get(User, user_id)
    if target is None or target.deleted_at is not None:
        raise AppError("USER_NOT_FOUND")
    if target.id == admin.id:
        raise AppError("ADMIN_SELF_FORBIDDEN", "不能删除自己")
    if target.role == "admin":
        raise AppError("ADMIN_ADMIN_FORBIDDEN", "不能删除管理员账号")

    target.deleted_at = datetime.now(timezone.utc)
    target.status = "disabled"
    target.token_version += 1

    write_audit(
        session,
        actor=admin,
        action="admin.user_delete",
        target_type="user",
        target_id=target.id,
        detail={"username": target.username},
        request=request,
    )
    await session.commit()
    logger.info(
        "管理员删除用户",
        extra={"event": "admin_user_delete", "target": target.username},
    )
    return Response(status_code=204)


@router.get("/stats", response_model=AdminStats, summary="平台统计")
async def stats(
    admin: AdminUser,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> AdminStats:
    base = User.deleted_at.is_(None)
    total_users = await session.scalar(
        select(func.count()).select_from(User).where(base)
    )
    active_users = await session.scalar(
        select(func.count()).select_from(User).where(base, User.status == "active")
    )
    disabled_users = await session.scalar(
        select(func.count()).select_from(User).where(base, User.status == "disabled")
    )
    total_conversations = await session.scalar(
        select(func.count())
        .select_from(Conversation)
        .where(Conversation.deleted_at.is_(None))
    )
    total_messages = await session.scalar(
        select(func.count())
        .select_from(Message)
        .join(Conversation, Conversation.id == Message.conversation_id)
        .where(Conversation.deleted_at.is_(None))
    )
    start_of_today = datetime.now(timezone.utc).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    today_messages = await session.scalar(
        select(func.count())
        .select_from(Message)
        .join(Conversation, Conversation.id == Message.conversation_id)
        .where(
            Conversation.deleted_at.is_(None),
            Message.created_at >= start_of_today,
        )
    )
    return AdminStats(
        total_users=int(total_users or 0),
        active_users=int(active_users or 0),
        disabled_users=int(disabled_users or 0),
        total_conversations=int(total_conversations or 0),
        total_messages=int(total_messages or 0),
        today_messages=int(today_messages or 0),
    )


@router.get("/audit-logs", response_model=AuditLogList, summary="审计日志")
async def audit_logs(
    admin: AdminUser,
    session: Annotated[AsyncSession, Depends(get_session)],
    q: Annotated[str | None, Query(max_length=64)] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> AuditLogList:
    conditions = []
    if q and q.strip():
        like = f"%{q.strip()}%"
        conditions.append(
            or_(
                AuditLog.actor_username.ilike(like),
                AuditLog.action.ilike(like),
                AuditLog.target_id.ilike(like),
            )
        )

    total = await session.scalar(
        select(func.count()).select_from(AuditLog).where(*conditions)
    )
    rows = (
        await session.scalars(
            select(AuditLog)
            .where(*conditions)
            .order_by(AuditLog.id.desc())
            .limit(limit)
            .offset(offset)
        )
    ).all()
    return AuditLogList(
        items=[AuditLogOut.model_validate(row) for row in rows],
        total=int(total or 0),
    )
