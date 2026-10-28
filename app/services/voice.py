"""阿里云百炼 Qwen3-TTS / Qwen3-ASR。

- TTS：非实时语音合成，返回 WAV 音频
- ASR：OpenAI 兼容接口，上传 Base64 Data URL，返回识别文本
"""
from __future__ import annotations

import base64
import uuid
from typing import Any

import httpx

from app.config import get_settings
from app.errors import AppError
from app.logging_config import get_logger

logger = get_logger("app.voice")

TTS_URL = "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation"
AUDIO_TTS_URL = "https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer"
VOICE_DESIGN_URL = "https://dashscope.aliyuncs.com/api/v1/services/audio/tts/customization"
ASR_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"

DEFAULT_VOICE = {
    "value": "Cherry",
    "label": "Cherry",
    "gender": "女",
    "description": "阳光积极、亲切自然的小姐姐",
    "kind": "system",
}


def default_voice() -> dict[str, str]:
    settings = get_settings()
    return {**DEFAULT_VOICE, "value": settings.default_voice_type}


def _split_text(text: str, limit: int = 500) -> list[str]:
    """按句号/问号/换行切分，保证每段不超过 TTS 的 600 字上限。"""
    text = text.strip()
    if not text:
        return []
    parts: list[str] = []
    current = ""
    for char in text:
        current += char
        if char in "。！？!?\n" and len(current) >= limit // 2:
            parts.append(current)
            current = ""
        elif len(current) >= limit:
            parts.append(current)
            current = ""
    if current:
        parts.append(current)
    return [p.strip() for p in parts if p.strip()]


def _normalize_wav(blob: bytes) -> tuple[int, int, int, bytes]:
    """把上游 WAV 统一成标准 44 字节头的 PCM 数据。

    百炼返回的流式 WAV 可能带有不准确的 data 长度，直接用 wave 读会算出
    异常时长；这里按实际字节数重建头。
    """
    if len(blob) < 44 or blob[:4] != b"RIFF" or blob[8:12] != b"WAVE":
        raise AppError("VOICE_TTS_FAILED", "上游返回的不是有效 WAV")

    pos = 12
    fmt = b""
    pcm = b""
    while pos + 8 <= len(blob):
        chunk_id = blob[pos : pos + 4]
        size = int.from_bytes(blob[pos + 4 : pos + 8], "little")
        start = pos + 8
        if chunk_id == b"fmt ":
            fmt = blob[start : min(start + size, len(blob))]
        elif chunk_id == b"data":
            pcm = blob[start:]
            break
        pos = start + size + (size & 1)

    if len(fmt) < 16 or not pcm:
        raise AppError("VOICE_TTS_FAILED", "上游 WAV 缺少 fmt/data 块")

    channels = int.from_bytes(fmt[2:4], "little")
    sample_rate = int.from_bytes(fmt[4:8], "little")
    bits = int.from_bytes(fmt[14:16], "little")
    sample_width = max(1, bits // 8)
    return channels, sample_rate, sample_width, pcm


def _build_wav(channels: int, sample_rate: int, sample_width: int, pcm: bytes) -> bytes:
    header = bytearray()
    header.extend(b"RIFF")
    header.extend((36 + len(pcm)).to_bytes(4, "little"))
    header.extend(b"WAVEfmt ")
    header.extend((16).to_bytes(4, "little"))
    header.extend((1).to_bytes(2, "little"))
    header.extend(channels.to_bytes(2, "little"))
    header.extend(sample_rate.to_bytes(4, "little"))
    header.extend((sample_rate * channels * sample_width).to_bytes(4, "little"))
    header.extend((channels * sample_width).to_bytes(2, "little"))
    header.extend((sample_width * 8).to_bytes(2, "little"))
    header.extend(b"data")
    header.extend(len(pcm).to_bytes(4, "little"))
    return bytes(header) + pcm


def _concat_wav(blobs: list[bytes]) -> bytes:
    if not blobs:
        raise AppError("VOICE_TTS_FAILED", "没有可用的音频片段")

    parsed = [_normalize_wav(blob) for blob in blobs]
    channels, sample_rate, sample_width, _ = parsed[0]
    pcm = b"".join(item[3] for item in parsed)
    return _build_wav(channels, sample_rate, sample_width, pcm)


async def _tts_segment(text: str, voice_type: str, model: str) -> bytes:
    settings = get_settings()
    if not settings.bailian_api_key:
        raise AppError("VOICE_KEY_MISSING")

    if model.startswith("qwen-audio"):
        url = AUDIO_TTS_URL
        payload = {
            "model": model,
            "input": {
                "text": text,
                "voice": voice_type,
                "format": "wav",
                "sample_rate": 24000,
            },
        }
    else:
        url = TTS_URL
        payload = {
            "model": model,
            "input": {
                "text": text,
                "voice": voice_type,
                "language_type": "Chinese",
            },
        }

    headers = {
        "Authorization": f"Bearer {settings.bailian_api_key}",
        "Content-Type": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(url, headers=headers, json=payload)
            if response.status_code != 200:
                detail = response.text[:300]
                logger.warning(
                    "TTS 上游失败",
                    extra={
                        "event": "voice_tts_failed",
                        "status": response.status_code,
                    },
                )
                if response.status_code in (401, 403):
                    raise AppError("VOICE_KEY_INVALID", detail=detail)
                if response.status_code == 429:
                    raise AppError("VOICE_RATE_LIMITED")
                raise AppError("VOICE_TTS_FAILED", detail=detail)

            data: dict[str, Any] = response.json()
            audio = (data.get("output") or {}).get("audio") or {}
            raw = audio.get("data") or ""
            url = audio.get("url") or ""

            if raw:
                return base64.b64decode(raw)
            if not url:
                raise AppError("VOICE_TTS_FAILED", "没有返回音频")

            download = await client.get(url, follow_redirects=True)
            if download.status_code != 200:
                raise AppError("VOICE_TTS_FAILED", detail=f"音频下载失败 HTTP {download.status_code}")
            return download.content
    except httpx.TimeoutException as exc:
        raise AppError("VOICE_TTS_FAILED", "语音合成超时") from exc
    except httpx.HTTPError as exc:
        raise AppError("VOICE_TTS_FAILED", detail=str(exc)) from exc


async def synthesize_speech(
    text: str,
    voice_type: str | None = None,
    model: str | None = None,
) -> bytes:
    settings = get_settings()
    text = text.strip()[: settings.max_tts_chars]
    if not text:
        raise AppError("SYS_VALIDATION", "朗读文本不能为空")

    chunks = _split_text(text)
    if not chunks:
        raise AppError("SYS_VALIDATION", "朗读文本不能为空")

    voice = voice_type or settings.default_voice_type
    use_model = model or settings.bailian_tts_model
    blobs: list[bytes] = []
    for chunk in chunks:
        blobs.append(await _tts_segment(chunk, voice, use_model))

    logger.info(
        "语音合成完成",
        extra={
            "event": "voice_tts_done",
            "chars": len(text),
            "segments": len(blobs),
            "voice": voice,
            "model": use_model,
        },
    )
    return _concat_wav(blobs)


async def design_voice(name: str, prompt: str, preview_text: str) -> dict[str, str]:
    """用自然语言描述创建一个自定义音色，返回 voice_id 与预览音频。"""
    settings = get_settings()
    if not settings.bailian_api_key:
        raise AppError("VOICE_KEY_MISSING")

    prefix = "aiqa" + uuid.uuid4().hex[:4]
    payload = {
        "model": "voice-enrollment",
        "input": {
            "action": "create_voice",
            "target_model": settings.bailian_design_tts_model,
            "voice_prompt": prompt,
            "preview_text": preview_text,
            "prefix": prefix,
            "language_hints": ["zh"],
        },
        "parameters": {"sample_rate": 24000, "response_format": "wav"},
    }
    headers = {
        "Authorization": f"Bearer {settings.bailian_api_key}",
        "Content-Type": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(VOICE_DESIGN_URL, headers=headers, json=payload)
            if response.status_code != 200:
                detail = response.text[:300]
                logger.warning(
                    "声音设计失败",
                    extra={
                        "event": "voice_design_failed",
                        "status": response.status_code,
                    },
                )
                if response.status_code in (401, 403):
                    raise AppError("VOICE_KEY_INVALID", detail=detail)
                if response.status_code == 429:
                    raise AppError("VOICE_RATE_LIMITED")
                raise AppError("VOICE_DESIGN_FAILED", detail=detail)

            data = response.json()
            output = data.get("output") or {}
            voice_id = str(output.get("voice_id") or "")
            preview = (output.get("preview_audio") or {}).get("data") or ""
            if not voice_id or not preview:
                raise AppError("VOICE_DESIGN_FAILED", "没有返回音色或预览音频")

            target_model = output.get("target_model") or settings.bailian_design_tts_model
            logger.info(
                "声音设计完成",
                extra={
                    "event": "voice_design_done",
                    "voice_id": voice_id,
                    "target_model": target_model,
                },
            )
            return {
                "voice_id": voice_id,
                "preview_audio": preview,
                "target_model": target_model,
            }
    except httpx.TimeoutException as exc:
        raise AppError("VOICE_DESIGN_FAILED", "声音设计超时") from exc
    except httpx.HTTPError as exc:
        raise AppError("VOICE_DESIGN_FAILED", detail=str(exc)) from exc


async def transcribe_audio(data: bytes, content_type: str) -> str:
    settings = get_settings()
    if not settings.bailian_api_key:
        raise AppError("VOICE_KEY_MISSING")
    if len(data) > 10 * 1024 * 1024:
        raise AppError("VOICE_AUDIO_TOO_LARGE")
    if not data:
        raise AppError("SYS_VALIDATION", "音频内容不能为空")

    mime = (content_type or "audio/wav").split(";")[0].strip()
    if mime not in ("audio/wav", "audio/x-wav", "audio/mpeg", "audio/mp3", "audio/webm"):
        mime = "audio/wav"
    data_uri = f"data:{mime};base64,{base64.b64encode(data).decode()}"

    payload = {
        "model": settings.bailian_asr_model,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "input_audio", "input_audio": {"data": data_uri}}
                ],
            }
        ],
        "stream": False,
        "asr_options": {"enable_itn": True},
    }
    headers = {
        "Authorization": f"Bearer {settings.bailian_api_key}",
        "Content-Type": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(ASR_URL, headers=headers, json=payload)
            if response.status_code != 200:
                detail = response.text[:300]
                logger.warning(
                    "ASR 上游失败",
                    extra={
                        "event": "voice_asr_failed",
                        "status": response.status_code,
                    },
                )
                if response.status_code in (401, 403):
                    raise AppError("VOICE_KEY_INVALID", detail=detail)
                if response.status_code == 429:
                    raise AppError("VOICE_RATE_LIMITED")
                raise AppError("VOICE_ASR_FAILED", detail=detail)

            data_json = response.json()
            text = (
                ((data_json.get("choices") or [{}])[0].get("message") or {}).get("content")
                or ""
            ).strip()
            if not text:
                raise AppError("VOICE_ASR_FAILED", "没有识别到文字")
            logger.info(
                "语音识别完成",
                extra={"event": "voice_asr_done", "chars": len(text)},
            )
            return text
    except httpx.TimeoutException as exc:
        raise AppError("VOICE_ASR_FAILED", "语音识别超时") from exc
    except httpx.HTTPError as exc:
        raise AppError("VOICE_ASR_FAILED", detail=str(exc)) from exc
