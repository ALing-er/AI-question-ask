"""模型列表接口。"""
from dataclasses import asdict

from fastapi import APIRouter

from app.deps import CurrentUser
from app.providers import registry

router = APIRouter(prefix="/api/models", tags=["models"])


@router.get("", summary="可用模型列表")
async def list_models(user: CurrentUser) -> dict:
    models = [asdict(m) for m in registry.list_models()]
    return {"models": models}
