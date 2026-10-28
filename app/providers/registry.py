"""模型注册表：读 config/models.yaml，把 model_id 解析成 provider + key。"""
from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from typing import Any

import yaml

from app.core.config import BASE_DIR, get_settings
from app.core.errors import AppError
from app.core.logging_setup import get_logger
from app.providers.openai_compat import OpenAICompatibleProvider

logger = get_logger("app.registry")

CONFIG_PATH = BASE_DIR / "config" / "models.yaml"


@dataclass(frozen=True)
class ModelInfo:
    id: str
    name: str
    provider_id: str
    provider_name: str
    available: bool
    supports_search: bool
    is_default: bool


@dataclass(frozen=True)
class ResolvedModel:
    provider: dict[str, Any]
    model: dict[str, Any]
    api_key: str
    provider_impl: OpenAICompatibleProvider
    supports_search: bool


@lru_cache(maxsize=1)
def load_config() -> dict[str, Any]:
    if not CONFIG_PATH.exists():
        logger.error("模型配置文件不存在", extra={"event": "models_yaml_missing", "path": str(CONFIG_PATH)})
        return {"providers": []}

    raw = yaml.safe_load(CONFIG_PATH.read_text(encoding="utf-8")) or {}
    providers = raw.get("providers") or []
    logger.info(
        "加载模型配置",
        extra={"event": "models_loaded", "providers": len(providers)},
    )
    return {"providers": providers}


def reload_config() -> None:
    load_config.cache_clear()


def _api_key_of(provider: dict[str, Any]) -> str:
    settings = get_settings()
    env_name = (provider.get("api_key_env") or "").upper()
    if not env_name:
        return ""
    return getattr(settings, env_name.lower(), "") or ""


def list_models() -> list[ModelInfo]:
    settings = get_settings()
    result: list[ModelInfo] = []
    for provider in load_config()["providers"]:
        if not provider.get("enabled", True):
            continue
        key = _api_key_of(provider)
        for model in provider.get("models") or []:
            # hidden 的模型只用于已有会话和 fallback，不进前端可选列表
            if model.get("hidden"):
                continue
            result.append(
                ModelInfo(
                    id=model["id"],
                    name=model.get("name") or model["id"],
                    provider_id=provider["id"],
                    provider_name=provider.get("name") or provider["id"],
                    available=bool(key),
                    supports_search=bool(model.get("search")),
                    is_default=model["id"] == settings.default_model_id,
                )
            )
    return result


def is_known_model(model_id: str) -> bool:
    """只检查 model_id 是否属于已启用的 provider，不要求密钥已配置。"""
    for provider in load_config()["providers"]:
        if not provider.get("enabled", True):
            continue
        for model in provider.get("models") or []:
            if model.get("id") == model_id:
                return True
    return False


def fallback_chain(model_id: str) -> list[str]:
    """返回 [主模型, 备用1, 备用2...]。配置里 fallback 支持字符串或列表。"""
    for provider in load_config()["providers"]:
        if not provider.get("enabled", True):
            continue
        for model in provider.get("models") or []:
            if model["id"] != model_id:
                continue
            fallback = model.get("fallback") or []
            if isinstance(fallback, str):
                fallback = [fallback]
            chain = [model_id]
            for item in fallback:
                if item and item not in chain:
                    chain.append(item)
            return chain
    return [model_id]


def resolve(model_id: str) -> ResolvedModel:
    """按 model_id 找到 provider 与 key，找不到就报 MODEL_NOT_FOUND。"""
    settings = get_settings()
    for provider in load_config()["providers"]:
        if not provider.get("enabled", True):
            continue
        for model in provider.get("models") or []:
            if model["id"] != model_id:
                continue

            api_key = _api_key_of(provider)
            if not api_key:
                raise AppError(
                    "MODEL_KEY_MISSING",
                    f"模型 {model_id} 的密钥未配置（{provider.get('api_key_env')}）",
                )

            impl = OpenAICompatibleProvider(
                base_url=provider["base_url"],
                connect_timeout=settings.upstream_connect_timeout,
                total_timeout=settings.upstream_total_timeout,
                stream_options=provider.get("stream_options"),
            )
            return ResolvedModel(
                provider=provider,
                model=model,
                api_key=api_key,
                provider_impl=impl,
                supports_search=bool(model.get("search")),
            )

    raise AppError("MODEL_NOT_FOUND", f"模型 {model_id} 不存在或未启用")
