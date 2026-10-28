"""会话与消息接口。

所有会话级操作都通过 OwnConversation 依赖取对象，
别人的会话在这里就已经变成 404 了，路由体里不需要再判权。
"""
from datetime import datetime, timezone
from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import exists, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import get_session
from app.deps import CurrentUser, OwnConversation
from app.errors import AppError
from app.logging_config import get_logger
from app.models import Conversation, Message
from app.providers import registry
from app.schemas import (
    ConversationCreate,
    ConversationOut,
    ConversationUpdate,
    MessageOut,
)

router = APIRouter(prefix="/api/conversations", tags=["conversations"])
logger = get_logger("app.conversations")


@router.get("", response_model=list[ConversationOut], summary="我的会话列表")
async def list_conversations(
    user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_session)],
    q: Annotated[str | None, Query(max_length=100)] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[ConversationOut]:
    stmt = select(Conversation).where(
        Conversation.user_id == user.id, Conversation.deleted_at.is_(None)
    )
    if q and q.strip():
        like = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(
                Conversation.title.ilike(like),
                exists(
                    select(Message.id).where(
                        Message.conversation_id == Conversation.id,
                        Message.content.ilike(like),
                    )
                ),
            )
        )
    stmt = stmt.order_by(
        Conversation.updated_at.desc(), Conversation.id.desc()
    ).limit(limit).offset(offset)
    rows = (await session.scalars(stmt)).all()
    return [ConversationOut.model_validate(row) for row in rows]


@router.post("", response_model=ConversationOut, status_code=201, summary="新建会话")
async def create_conversation(
    payload: ConversationCreate,
    user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> ConversationOut:
    settings = get_settings()
    model_id = payload.model_id or settings.default_model_id
    if not registry.is_known_model(model_id):
        raise AppError("MODEL_NOT_FOUND", f"模型 {model_id} 不存在或未启用")

    conversation = Conversation(
        user_id=user.id,
        title=payload.title or "新会话",
        model_id=model_id,
        system_prompt=(payload.system_prompt or "").strip() or None,
    )
    session.add(conversation)
    await session.commit()
    await session.refresh(conversation)

    logger.info(
        "新建会话",
        extra={"event": "conversation_create", "conversation_id": conversation.id},
    )
    return ConversationOut.model_validate(conversation)


@router.get("/{conversation_id}", response_model=ConversationOut, summary="会话详情")
async def get_conversation(conversation: OwnConversation) -> ConversationOut:
    return ConversationOut.model_validate(conversation)


@router.patch("/{conversation_id}", response_model=ConversationOut, summary="改名/换默认模型")
async def update_conversation(
    payload: ConversationUpdate,
    conversation: OwnConversation,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> ConversationOut:
    if (
        payload.title is None
        and payload.model_id is None
        and payload.system_prompt is None
    ):
        raise AppError("SYS_VALIDATION", "没有需要更新的字段")

    if payload.title is not None:
        conversation.title = payload.title
    if payload.model_id is not None:
        if not registry.is_known_model(payload.model_id):
            raise AppError(
                "MODEL_NOT_FOUND", f"模型 {payload.model_id} 不存在或未启用"
            )
        conversation.model_id = payload.model_id
    if payload.system_prompt is not None:
        conversation.system_prompt = payload.system_prompt.strip() or None

    await session.commit()
    await session.refresh(conversation)

    logger.info(
        "更新会话",
        extra={"event": "conversation_update", "conversation_id": conversation.id},
    )
    return ConversationOut.model_validate(conversation)


@router.delete("/{conversation_id}", status_code=204, summary="删除会话（软删）")
async def delete_conversation(
    conversation: OwnConversation,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> Response:
    conversation.deleted_at = datetime.now(timezone.utc)
    await session.commit()

    logger.info(
        "删除会话",
        extra={"event": "conversation_delete", "conversation_id": conversation.id},
    )
    return Response(status_code=204)


@router.get("/{conversation_id}/export", summary="导出 Markdown")
async def export_conversation(
    conversation: OwnConversation,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> Response:
    rows = (
        await session.scalars(
            select(Message)
            .where(Message.conversation_id == conversation.id)
            .order_by(Message.id.asc())
        )
    ).all()

    lines: list[str] = [
        f"# {conversation.title}",
        "",
        f"> 模型：{conversation.model_id}",
        f"> 创建时间：{conversation.created_at.isoformat()}",
        f"> 导出时间：{datetime.now(timezone.utc).isoformat()}",
        "",
    ]
    for row in rows:
        heading = {"user": "用户", "assistant": "助手"}.get(row.role, row.role)
        lines.extend([f"## {heading}", "", row.content or "", ""])
        if row.reasoning:
            lines.extend(
                [
                    "<details>",
                    "<summary>思考过程</summary>",
                    "",
                    row.reasoning,
                    "",
                    "</details>",
                    "",
                ]
            )

    filename = f"{conversation.title or 'conversation'}-{conversation.id}.md"
    ascii_name = f"conversation-{conversation.id}.md"
    headers = {
        "Content-Disposition": (
            f'attachment; filename="{ascii_name}"; '
            f"filename*=UTF-8''{quote(filename, safe='')}"
        )
    }
    return Response(
        content="\n".join(lines),
        media_type="text/markdown; charset=utf-8",
        headers=headers,
    )


@router.get(
    "/{conversation_id}/messages",
    response_model=list[MessageOut],
    summary="会话消息",
)
async def list_messages(
    conversation: OwnConversation,
    session: Annotated[AsyncSession, Depends(get_session)],
    limit: Annotated[int, Query(ge=1, le=500)] = 200,
) -> list[MessageOut]:
    stmt = (
        select(Message)
        .where(Message.conversation_id == conversation.id)
        .order_by(Message.id.asc())
        .limit(limit)
    )
    rows = (await session.scalars(stmt)).all()
    return [MessageOut.model_validate(row) for row in rows]
