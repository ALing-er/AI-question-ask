"""角色设定与提示词美化。

角色设定是用户级资源，可以重复应用到不同会话；
应用到会话时，前端把 prompt 写入 conversation.system_prompt。
"""
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.deps import CurrentUser
from app.core.errors import AppError
from app.core.logging_setup import get_logger
from app.db import get_session
from app.db.models import Persona
from app.providers import registry
from app.schemas import (
    BeautifyPromptRequest,
    BeautifyPromptResponse,
    PersonaCreate,
    PersonaOut,
    PersonaUpdate,
    VoicePromptRequest,
    VoicePromptResponse,
)

router = APIRouter(prefix="/api/personas", tags=["personas"])
logger = get_logger("app.personas")

BEAUTIFY_SYSTEM_PROMPT = """你是一个角色设定提示词优化助手。
请把用户给出的角色描述改写为一段可直接用作 system prompt 的中文角色设定。
要求：
1. 保留用户原意，不要添加用户未提及的事实；
2. 结构清晰，包含角色身份、性格、说话风格、回答规则、边界；
3. 语言简洁，200-400 字；
4. 只输出改写后的提示词正文，不要解释、不要加代码块、不要加标题。"""

VOICE_PROMPT_SYSTEM_PROMPT = """你是一个音色设定助手。
请根据角色设定，写一段用于语音合成的音色描述。
要求：
1. 包含性别、年龄感、音色质感、语速、语调、情绪风格；
2. 与角色性格一致；
3. 50-120 字；
4. 只输出音色描述正文，不要解释、不要加代码块、不要加标题。"""


def _clean_prompt(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        text = "\n".join(lines).strip()
    return text[:4000]


async def _generate(system_prompt: str, user_prompt: str) -> str:
    settings = get_settings()
    chain = registry.fallback_chain(settings.persona_model_id)
    last_error: AppError | None = None

    for candidate in chain:
        agen = None
        try:
            resolved = registry.resolve(candidate)
            agen = resolved.provider_impl.stream_chat(
                model_id=candidate,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                api_key=resolved.api_key,
                options={"temperature": 0.7},
            )

            pieces: list[str] = []
            async for chunk in agen:
                if chunk.text:
                    pieces.append(chunk.text)

            text = _clean_prompt("".join(pieces))
            if text:
                logger.info(
                    "提示词美化完成",
                    extra={
                        "event": "persona_beautify",
                        "model": candidate,
                        "chars": len(text),
                    },
                )
                return text
            last_error = AppError("MODEL_UPSTREAM_ERROR", "模型没有返回美化结果")
        except AppError as exc:
            last_error = exc
            logger.warning(
                "提示词美化失败",
                extra={
                    "event": "persona_beautify_failed",
                    "model": candidate,
                    "code": exc.code,
                },
            )
        finally:
            if agen is not None:
                try:
                    await agen.aclose()
                except Exception:  # noqa: BLE001
                    pass

    raise last_error or AppError("MODEL_UPSTREAM_ERROR", "提示词美化失败")


async def _get_persona(
    session: AsyncSession, user_id: int, persona_id: int
) -> Persona:
    persona = await session.scalar(
        select(Persona).where(
            Persona.id == persona_id,
            Persona.user_id == user_id,
            Persona.deleted_at.is_(None),
        )
    )
    if persona is None:
        raise AppError("PERSONA_NOT_FOUND")
    return persona


@router.get("", response_model=list[PersonaOut], summary="我的角色设定")
async def list_personas(
    user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> list[PersonaOut]:
    rows = (
        await session.scalars(
            select(Persona)
            .where(Persona.user_id == user.id, Persona.deleted_at.is_(None))
            .order_by(Persona.updated_at.desc(), Persona.id.desc())
        )
    ).all()
    return [PersonaOut.model_validate(row) for row in rows]


@router.post("", response_model=PersonaOut, status_code=201, summary="创建角色设定")
async def create_persona(
    payload: PersonaCreate,
    user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> PersonaOut:
    name = payload.name.strip()
    prompt = payload.prompt.strip()
    if not name:
        raise AppError("SYS_VALIDATION", "角色名称不能为空")
    if not prompt:
        raise AppError("SYS_VALIDATION", "角色提示词不能为空")

    persona = Persona(
        user_id=user.id,
        name=name,
        prompt=prompt,
        description=(payload.description or "").strip() or None,
        voice_type=(payload.voice_type or "").strip() or None,
        voice_prompt=(payload.voice_prompt or "").strip() or None,
    )
    session.add(persona)
    await session.commit()
    await session.refresh(persona)
    logger.info(
        "创建角色设定",
        extra={"event": "persona_create", "persona_id": persona.id},
    )
    return PersonaOut.model_validate(persona)


@router.patch("/{persona_id}", response_model=PersonaOut, summary="更新角色设定")
async def update_persona(
    persona_id: int,
    payload: PersonaUpdate,
    user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> PersonaOut:
    if (
        payload.name is None
        and payload.prompt is None
        and payload.description is None
        and payload.voice_type is None
        and payload.voice_prompt is None
    ):
        raise AppError("SYS_VALIDATION", "没有需要更新的字段")

    persona = await _get_persona(session, user.id, persona_id)

    if payload.name is not None:
        name = payload.name.strip()
        if not name:
            raise AppError("SYS_VALIDATION", "角色名称不能为空")
        persona.name = name
    if payload.prompt is not None:
        prompt = payload.prompt.strip()
        if not prompt:
            raise AppError("SYS_VALIDATION", "角色提示词不能为空")
        persona.prompt = prompt
    if payload.description is not None:
        persona.description = payload.description.strip() or None
    if payload.voice_type is not None:
        persona.voice_type = payload.voice_type.strip() or None
    if payload.voice_prompt is not None:
        persona.voice_prompt = payload.voice_prompt.strip() or None

    await session.commit()
    await session.refresh(persona)
    logger.info(
        "更新角色设定",
        extra={"event": "persona_update", "persona_id": persona.id},
    )
    return PersonaOut.model_validate(persona)


@router.delete("/{persona_id}", status_code=204, summary="删除角色设定（软删）")
async def delete_persona(
    persona_id: int,
    user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> Response:
    persona = await _get_persona(session, user.id, persona_id)

    persona.deleted_at = datetime.now(timezone.utc)
    await session.commit()
    logger.info(
        "删除角色设定",
        extra={"event": "persona_delete", "persona_id": persona.id},
    )
    return Response(status_code=204)


@router.post(
    "/beautify",
    response_model=BeautifyPromptResponse,
    summary="美化角色提示词",
)
async def beautify_prompt(
    payload: BeautifyPromptRequest,
    user: CurrentUser,
) -> BeautifyPromptResponse:
    prompt = payload.prompt.strip()
    if not prompt:
        raise AppError("SYS_VALIDATION", "提示词不能为空")
    return BeautifyPromptResponse(
        prompt=await _generate(BEAUTIFY_SYSTEM_PROMPT, prompt)
    )


@router.post(
    "/voice-prompt",
    response_model=VoicePromptResponse,
    summary="根据角色生成音色描述",
)
async def generate_voice_prompt(
    payload: VoicePromptRequest,
    user: CurrentUser,
) -> VoicePromptResponse:
    role_prompt = payload.role_prompt.strip()
    if not role_prompt:
        raise AppError("SYS_VALIDATION", "角色提示词不能为空")
    current = (payload.current_prompt or "").strip()
    user_content = (
        f"角色设定：\n{role_prompt}\n\n"
        f"已有音色描述：\n{current or '无'}\n\n"
        "请生成或优化一段音色描述。"
    )
    result = await _generate(VOICE_PROMPT_SYSTEM_PROMPT, user_content)
    return VoicePromptResponse(prompt=result[:2000])
