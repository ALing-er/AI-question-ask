"""语音合成、语音识别与自定义音色（阿里云百炼）。"""
from typing import Annotated

from fastapi import APIRouter, Depends, File, Response, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import get_session
from app.deps import CurrentUser
from app.errors import AppError
from app.models import CustomVoice
from app.schemas import VoiceDesignRequest, VoiceDesignResponse, VoiceOptionOut
from app.services import voice as voice_service

router = APIRouter(prefix="/api/voice", tags=["voice"])


class TTSRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=20000)
    voice_type: str | None = Field(default=None, max_length=128)


@router.get("/voices", summary="可选音色列表")
async def list_voices(
    user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> dict:
    rows = (
        await session.scalars(
            select(CustomVoice)
            .where(
                CustomVoice.user_id == user.id,
                CustomVoice.deleted_at.is_(None),
            )
            .order_by(CustomVoice.created_at.desc(), CustomVoice.id.desc())
        )
    ).all()

    custom = [
        VoiceOptionOut(
            id=row.id,
            value=row.voice_id,
            label=row.name,
            gender="",
            description=row.prompt,
            kind="custom",
        )
        for row in rows
    ]
    return {
        "default_voice": voice_service.default_voice(),
        "voices": custom,
    }


@router.post(
    "/design",
    response_model=VoiceDesignResponse,
    summary="用提示词生成自定义音色",
)
async def design_voice(
    payload: VoiceDesignRequest,
    user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> VoiceDesignResponse:
    name = payload.name.strip()
    prompt = payload.prompt.strip()
    if not name or not prompt:
        raise AppError("SYS_VALIDATION", "音色名称和描述不能为空")

    preview_text = (payload.preview_text or "你好，这是自定义音色的试听示例。").strip()
    if len(preview_text) < 15 or len(preview_text) > 200:
        raise AppError("SYS_VALIDATION", "试听文本长度需在 15-200 字之间")

    result = await voice_service.design_voice(name, prompt, preview_text)
    row = CustomVoice(
        user_id=user.id,
        voice_id=result["voice_id"],
        name=name,
        prompt=prompt,
        target_model=result["target_model"],
        preview_text=preview_text,
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)

    return VoiceDesignResponse(
        voice=VoiceOptionOut(
            id=row.id,
            value=row.voice_id,
            label=row.name,
            gender="",
            description=row.prompt,
            kind="custom",
        ),
        preview_audio=result["preview_audio"],
        preview_format="wav",
    )


@router.post("/tts", summary="语音合成", response_class=Response)
async def tts(
    payload: TTSRequest,
    user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> Response:
    settings = get_settings()
    voice_type = payload.voice_type or settings.default_voice_type
    model = settings.bailian_tts_model

    if voice_type != settings.default_voice_type:
        custom = await session.scalar(
            select(CustomVoice).where(
                CustomVoice.user_id == user.id,
                CustomVoice.voice_id == voice_type,
                CustomVoice.deleted_at.is_(None),
            )
        )
        if custom is None:
            raise AppError("VOICE_NOT_FOUND")
        model = custom.target_model

    audio = await voice_service.synthesize_speech(
        payload.text, voice_type, model
    )
    return Response(
        content=audio,
        media_type="audio/wav",
        headers={"Cache-Control": "no-store"},
    )


@router.post("/asr", summary="语音识别")
async def asr(
    user: CurrentUser,
    file: Annotated[UploadFile, File(...)],
) -> dict:
    data = await file.read()
    text = await voice_service.transcribe_audio(
        data, file.content_type or "audio/wav"
    )
    return {"text": text}
