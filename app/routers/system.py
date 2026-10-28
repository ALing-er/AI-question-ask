"""公开的系统配置，供登录页 / 注册页 / 输入框使用。"""
from fastapi import APIRouter

from app.config import get_settings

router = APIRouter(prefix="/api/system", tags=["system"])


@router.get("/config", summary="公开配置")
async def public_config() -> dict:
    settings = get_settings()
    return {
        "app_name": settings.app_name,
        "allow_registration": settings.allow_registration,
        "max_message_chars": settings.max_message_chars,
        "max_context_turns": settings.max_context_turns,
        "default_model_id": settings.default_model_id,
    }
