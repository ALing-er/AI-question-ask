"""审计日志写入。

只记录操作元数据：动作、操作者、目标、IP。
绝不记录密码、token 或聊天正文。
"""
from typing import Any

from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AuditLog, User


def write_audit(
    session: AsyncSession,
    *,
    actor: User | None,
    action: str,
    target_type: str | None = None,
    target_id: int | str | None = None,
    detail: dict[str, Any] | None = None,
    request: Request | None = None,
) -> AuditLog:
    entry = AuditLog(
        actor_id=actor.id if actor is not None else None,
        actor_username=actor.username if actor is not None else "-",
        action=action,
        target_type=target_type,
        target_id=str(target_id) if target_id is not None else None,
        detail=detail,
        ip=request.client.host if request is not None and request.client else None,
    )
    session.add(entry)
    return entry
