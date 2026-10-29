"""流式对话接口（SSE）。

设计要点：
1. 用户的提问先落库、提交，再开始流式输出 —— 即使中途断开，问题不会丢
2. 主模型失败时按 models.yaml 里的 fallback 链自动切换（只在第一个 token 之前）
3. assistant 先建一条 status=streaming 的占位消息，前端拿 meta 事件里的 id 就能先渲染气泡
4. 结束/中断/报错都会把最终内容回写同一条消息（status: done / aborted / error）
5. 客户端断开通过 request.is_disconnected() 检测，检测到就停止拉取上游，避免继续计费
"""
import asyncio
import json
import time
from collections.abc import AsyncIterator
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.deps import CurrentUser
from app.core.errors import AppError
from app.core.logging_setup import get_logger
from app.core.tokens import estimate_tokens
from app.db import AsyncSessionLocal, get_session
from app.db.models import Conversation, Message
from app.providers import registry
from app.schemas import ChatRequest

router = APIRouter(prefix="/api/chat", tags=["chat"])
logger = get_logger("app.chat")

SSE_HEADERS = {
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    # 关掉 nginx 这类反向代理的缓冲，否则会变成"憋一大段再吐"
    "X-Accel-Buffering": "no",
}


def sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


async def _build_context(
    session: AsyncSession,
    conversation: Conversation,
    max_turns: int,
    max_tokens: int,
) -> tuple[list[dict], int, int]:
    """组装上下文：系统提示词（含历史摘要）+ 最近 N 轮，按估算 token 裁剪。

    从最新消息往前累加，至少保留最新一条用户消息；
    已被摘要的消息不再重复发送，只通过摘要承接。
    返回 (context, 估算 tokens, 已压缩消息条数)。
    """
    settings = get_settings()
    system_prompt = (
        conversation.system_prompt or settings.default_system_prompt or ""
    ).strip()
    summary = (conversation.summary or "").strip()
    until = conversation.summary_until_id or 0
    if summary:
        block = f"【此前对话摘要】\n{summary}"
        system_prompt = f"{system_prompt}\n\n{block}" if system_prompt else block

    context: list[dict] = []
    if system_prompt:
        context.append({"role": "system", "content": system_prompt})

    summarized = 0
    if summary:
        summarized = await session.scalar(
            select(func.count(Message.id)).where(
                Message.conversation_id == conversation.id,
                Message.id <= until,
            )
        ) or 0

    used = estimate_tokens(system_prompt)
    limit = max_turns * 2
    stmt = (
        select(Message)
        .where(
            Message.conversation_id == conversation.id,
            Message.id > until,
        )
        .order_by(Message.id.desc())
        .limit(limit)
    )
    rows = (await session.scalars(stmt)).all()

    kept: list[Message] = []
    for row in rows:  # 已按 id 倒序，最新在前
        if row.role not in ("user", "assistant"):
            continue
        # 空内容（比如上一次失败的占位消息）不要塞进上下文
        if not row.content.strip():
            continue
        cost = estimate_tokens(row.content)
        if kept and used + cost > max_tokens:
            break
        kept.append(row)
        used += cost

    kept.reverse()
    context.extend({"role": row.role, "content": row.content} for row in kept)
    return context, used, summarized


@router.post("/stream", summary="流式对话（SSE）")
async def chat_stream(
    payload: ChatRequest,
    request: Request,
    user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_session)],
):
    settings = get_settings()
    content = payload.content.strip()
    if not content:
        raise AppError("SYS_VALIDATION", "消息内容不能为空")
    if len(content) > settings.max_message_chars:
        raise AppError(
            "SYS_VALIDATION",
            f"消息长度不能超过 {settings.max_message_chars} 字符",
        )

    conversation = await session.scalar(
        select(Conversation).where(
            Conversation.id == payload.conversation_id,
            Conversation.user_id == user.id,
            Conversation.deleted_at.is_(None),
        )
    )
    if conversation is None:
        raise AppError("CONV_NOT_FOUND")

    model_id = payload.model_id or conversation.model_id
    # 主模型必须能在配置里找到，否则直接返回 404（错误码有意义，前端能提示）
    registry.resolve(model_id)

    session.add(
        Message(
            conversation_id=conversation.id,
            role="user",
            content=content,
            model_id=model_id,
            status="done",
        )
    )
    # 首条消息自动生成标题
    if conversation.title == "新会话":
        conversation.title = content[:20]
    # 会话列表按 updated_at 倒序，发消息必须刷新它
    conversation.updated_at = datetime.now(timezone.utc)
    await session.commit()

    context, context_tokens, summarized_messages = await _build_context(
        session,
        conversation,
        settings.max_context_turns,
        settings.max_context_tokens,
    )

    logger.info(
        "开始对话",
        extra={
            "event": "chat_start",
            "conversation_id": conversation.id,
            "model": model_id,
            "context_messages": len(context),
            "context_tokens": context_tokens,
            "summarized_messages": summarized_messages,
        },
    )

    return StreamingResponse(
        _event_stream(
            conversation_id=conversation.id,
            model_id=model_id,
            context=context,
            context_tokens=context_tokens,
            summarized_messages=summarized_messages,
            web_search=payload.web_search,
            request=request,
        ),
        media_type="text/event-stream",
        headers=SSE_HEADERS,
    )


SEARCH_OPTIONS = {
    "enable_search": True,
    # 由模型自己判断要不要搜：闲聊不搜，问天气/新闻这类实时信息才搜
    "search_options": {
        "forced_search": False,
        "search_strategy": "turbo",
        "enable_source": True,
    },
}


async def _open_stream(model_id: str, context: list[dict], web_search: bool = True):
    """按 model_id 打开上游流，并先取出第一个 chunk。

    第一个 chunk 到手才算"成功"——只有在这之前，才允许切换备用模型。
    返回 (generator, first_chunk_or_None)。
    """
    resolved = registry.resolve(model_id)
    # 只有模型支持、且用户没关掉时才带搜索参数，否则上游会直接报错
    options = SEARCH_OPTIONS if web_search and resolved.supports_search else None
    agen = resolved.provider_impl.stream_chat(
        model_id=model_id,
        messages=context,
        api_key=resolved.api_key,
        options=options,
    )
    try:
        first = await agen.__anext__()
    except StopAsyncIteration:
        first = None
    return agen, first


async def _event_stream(
    *,
    conversation_id: int,
    model_id: str,
    context: list[dict],
    context_tokens: int,
    summarized_messages: int,
    web_search: bool,
    request: Request,
) -> AsyncIterator[str]:
    started = time.perf_counter()

    # ---------- 1. 选模型（主模型 → 备用链） ----------
    chain = registry.fallback_chain(model_id)
    agen = None
    first = None
    used_model = model_id
    last_error: AppError | None = None

    for candidate in chain:
        try:
            agen, first = await _open_stream(candidate, context, web_search)
            used_model = candidate
            if candidate != model_id:
                logger.warning(
                    "主模型不可用，已切换备用",
                    extra={
                        "event": "model_fallback",
                        "from": model_id,
                        "to": candidate,
                        "reason": last_error.code if last_error else None,
                    },
                )
            break
        except AppError as exc:
            last_error = exc
            logger.warning(
                "模型调用失败，尝试下一个",
                extra={
                    "event": "model_attempt_failed",
                    "model": candidate,
                    "code": exc.code,
                },
            )
            continue

    if agen is None:
        code = last_error.code if last_error else "MODEL_UPSTREAM_ERROR"
        message = last_error.message if last_error else "模型不可用"
        yield sse("error", {"code": code, "message": message})
        return

    # ---------- 2. 占位消息 + meta ----------
    async with AsyncSessionLocal() as db:
        placeholder = Message(
            conversation_id=conversation_id,
            role="assistant",
            content="",
            model_id=used_model,
            status="streaming",
        )
        db.add(placeholder)
        await db.commit()
        await db.refresh(placeholder)
        assistant_id = placeholder.id

    yield sse(
        "meta",
        {
            "message_id": assistant_id,
            "conversation_id": conversation_id,
            "model_id": used_model,
            # 前端用它展示本次上下文估算用量与已压缩条数
            "context_tokens": context_tokens,
            "summarized_messages": summarized_messages,
        },
    )

    pieces: list[str] = []
    reasoning_parts: list[str] = []
    usage: dict | None = None
    finish_reason: str | None = None
    status = "done"
    saved = False

    async def persist(final_status: str) -> None:
        async with AsyncSessionLocal() as db:
            row = await db.get(Message, assistant_id)
            if row is None:
                return
            row.content = "".join(pieces)
            row.reasoning = "".join(reasoning_parts) or None
            row.status = final_status
            row.input_tokens = (usage or {}).get("input_tokens")
            row.output_tokens = (usage or {}).get("output_tokens")
            row.latency_ms = int((time.perf_counter() - started) * 1000)
            await db.commit()

    # ---------- 3. 消费流 ----------
    try:
        if first is not None:
            if first.text:
                pieces.append(first.text)
                yield sse("delta", {"text": first.text})
            if first.reasoning:
                reasoning_parts.append(first.reasoning)
                yield sse("reasoning", {"text": first.reasoning})
            if first.usage:
                usage = first.usage
            if first.finish_reason:
                finish_reason = first.finish_reason

        async for chunk in agen:
            if chunk.text:
                pieces.append(chunk.text)
                yield sse("delta", {"text": chunk.text})
            if chunk.reasoning:
                reasoning_parts.append(chunk.reasoning)
                yield sse("reasoning", {"text": chunk.reasoning})
            if chunk.usage:
                usage = chunk.usage
            if chunk.finish_reason:
                finish_reason = chunk.finish_reason

            if await request.is_disconnected():
                status = "aborted"
                logger.info(
                    "客户端断开，停止生成",
                    extra={"event": "chat_aborted", "conversation_id": conversation_id},
                )
                break

        if status == "done":
            if usage:
                yield sse("usage", usage)
            yield sse("done", {"finish_reason": finish_reason or "stop"})

    except asyncio.CancelledError:
        # 连接被强制掐断时走到这里，已生成的内容也要保住
        status = "aborted"
        saved = True
        asyncio.create_task(persist("aborted"))
        raise
    except AppError as exc:
        status = "error"
        logger.warning(
            "生成失败",
            extra={"event": "chat_error", "code": exc.code, "conversation_id": conversation_id},
        )
        try:
            yield sse("error", {"code": exc.code, "message": exc.message})
        except Exception:  # noqa: BLE001
            pass

    finally:
        if not saved:
            saved = True
            await persist(status)
            logger.info(
                "对话结束",
                extra={
                    "event": "chat_done",
                    "conversation_id": conversation_id,
                    "message_id": assistant_id,
                    "model": used_model,
                    "status": status,
                    "chars": len("".join(pieces)),
                    "latency_ms": int((time.perf_counter() - started) * 1000),
                    "usage": usage,
                },
            )
            # 回答结束后异步压缩旧消息，不阻塞本次响应
            asyncio.create_task(_maybe_summarize(conversation_id))
        try:
            await agen.aclose()
        except Exception:  # noqa: BLE001
            pass


SUMMARY_SYSTEM_PROMPT = (
    "你是一个对话摘要助手。请把给出的对话压缩成简洁的中文摘要，"
    "只保留：用户的目标与偏好、关键事实与结论、尚未解决的问题、重要约定。"
    "不要编造，不要输出 Markdown 标题或代码块，控制在 500 字以内。"
)
SUMMARY_INPUT_CHARS = 16000
SUMMARY_MAX_CHARS = 800

# 摘要调用低频且造价不低，串行执行即可，避免同一会话被并发压缩
_summary_lock = asyncio.Lock()


async def _maybe_summarize(conversation_id: int) -> None:
    """把较早的消息压成滚动摘要，最近若干条继续保留原文。

    触发条件：未摘要消息的估算 token 超过 SUMMARY_TRIGGER_TOKENS。
    一次只压缩能放下的前缀，剩余部分留给下一次，避免单次输入过大。
    """
    try:
        async with _summary_lock:
            settings = get_settings()
            async with AsyncSessionLocal() as db:
                conversation = await db.get(Conversation, conversation_id)
                if conversation is None or conversation.deleted_at is not None:
                    return

                until = conversation.summary_until_id or 0
                stmt = (
                    select(Message)
                    .where(
                        Message.conversation_id == conversation_id,
                        Message.id > until,
                        Message.role.in_(("user", "assistant")),
                    )
                    .order_by(Message.id.asc())
                )
                rows = [
                    row for row in (await db.scalars(stmt)).all() if row.content.strip()
                ]
                keep = max(2, settings.summary_keep_messages)
                if len(rows) <= keep:
                    return

                total = sum(estimate_tokens(row.content) for row in rows)
                if total <= settings.summary_trigger_tokens:
                    return

                pieces: list[str] = []
                used = 0
                last_id = until
                for row in rows[:-keep]:
                    label = "用户" if row.role == "user" else "助手"
                    piece = f"{label}：{row.content.strip()}\n"
                    remaining = SUMMARY_INPUT_CHARS - used
                    if remaining <= 0:
                        break
                    if len(piece) > remaining:
                        piece = piece[:remaining]
                    pieces.append(piece)
                    used += len(piece)
                    last_id = row.id

                if not pieces:
                    return

                user_prompt = (
                    f"已有摘要：\n{conversation.summary or '（无）'}\n\n"
                    f"新增对话：\n{''.join(pieces)}\n\n"
                    "请输出更新后的摘要。"
                )
                summary = await _generate_summary(user_prompt)
                if not summary:
                    return

                conversation.summary = summary
                conversation.summary_until_id = last_id
                await db.commit()
                logger.info(
                    "会话摘要已更新",
                    extra={
                        "event": "summary_updated",
                        "conversation_id": conversation_id,
                        "until_id": last_id,
                        "chars": len(summary),
                    },
                )
    except Exception:  # noqa: BLE001
        logger.exception(
            "生成会话摘要失败",
            extra={"event": "summary_failed", "conversation_id": conversation_id},
        )


async def _generate_summary(user_prompt: str) -> str | None:
    settings = get_settings()
    chain = registry.fallback_chain(settings.summary_model_id)

    for candidate in chain:
        agen = None
        try:
            resolved = registry.resolve(candidate)
            agen = resolved.provider_impl.stream_chat(
                model_id=candidate,
                messages=[
                    {"role": "system", "content": SUMMARY_SYSTEM_PROMPT},
                    {"role": "user", "content": user_prompt},
                ],
                api_key=resolved.api_key,
                options={"temperature": 0.3},
            )
            pieces: list[str] = []
            async for chunk in agen:
                if chunk.text:
                    pieces.append(chunk.text)
            text = "".join(pieces).strip()
            if text:
                return text[:SUMMARY_MAX_CHARS]
        except AppError as exc:
            logger.warning(
                "摘要模型调用失败，尝试下一个",
                extra={"event": "summary_attempt_failed", "model": candidate, "code": exc.code},
            )
        finally:
            if agen is not None:
                try:
                    await agen.aclose()
                except Exception:  # noqa: BLE001
                    pass
    return None
