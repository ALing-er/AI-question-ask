import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from app.bootstrap import ensure_seed_admin
from app.config import BASE_DIR, get_settings
from app.db import AsyncSessionLocal, cleanup_revoked_tokens, dispose_db, init_db
from app.errors import AppError, build_error_body, register_exception_handlers
from app.logging_config import get_logger, request_id_ctx, setup_logging, user_id_ctx
from app.routers import admin as admin_router
from app.routers import auth as auth_router
from app.routers import chat as chat_router
from app.routers import conversations as conversations_router
from app.routers import models as models_router
from app.routers import system as system_router

APP_VERSION = "0.1.0"

settings = get_settings()

# 必须在创建 app 之前配置好日志，否则启动期的日志会丢
setup_logging(
    level=settings.log_level,
    log_dir=settings.log_path,
    retention_days=settings.log_retention_days,
    json_mode=settings.is_prod,
)
logger = get_logger("app.main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    await ensure_seed_admin()
    await cleanup_revoked_tokens()
    logger.info(
        "应用启动",
        extra={"event": "startup", "env": settings.app_env, "version": APP_VERSION},
    )
    yield
    await dispose_db()
    logger.info("应用关闭", extra={"event": "shutdown"})


app = FastAPI(
    title=settings.app_name,
    version=APP_VERSION,
    lifespan=lifespan,
    docs_url="/docs" if settings.debug else None,
    redoc_url=None,
)


@app.middleware("http")
async def request_context_middleware(request: Request, call_next):
    """生成 request_id，写访问日志，兜住未捕获异常。"""
    rid = uuid.uuid4().hex[:12]
    rid_token = request_id_ctx.set(rid)
    uid_token = user_id_ctx.set("-")
    started = time.perf_counter()
    status_code = 500
    failed = False

    try:
        response = await call_next(request)
        status_code = response.status_code
        response.headers["X-Request-Id"] = rid
        return response
    except Exception:
        failed = True
        logger.exception(
            "未捕获异常", extra={"event": "unhandled_exception", "path": request.url.path}
        )
        body = build_error_body("SYS_INTERNAL", "服务器内部错误", None, rid)
        resp = JSONResponse(status_code=500, content=body)
        resp.headers["X-Request-Id"] = rid
        return resp
    finally:
        if not failed:
            elapsed_ms = round((time.perf_counter() - started) * 1000, 1)
            payload = {
                "event": "http_request",
                "method": request.method,
                "path": request.url.path,
                "status": status_code,
                "duration_ms": elapsed_ms,
            }
            if status_code >= 500:
                logger.error("HTTP %s %s -> %s", request.method, request.url.path, status_code, extra=payload)
            elif status_code >= 400:
                logger.warning("HTTP %s %s -> %s", request.method, request.url.path, status_code, extra=payload)
            else:
                logger.info("HTTP %s %s -> %s", request.method, request.url.path, status_code, extra=payload)
        request_id_ctx.reset(rid_token)
        user_id_ctx.reset(uid_token)


# CORS 最后 add，保证它在最外层（错误响应也能带 CORS 头）
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Request-Id"],
)

register_exception_handlers(app)

app.include_router(auth_router.router)
app.include_router(conversations_router.router)
app.include_router(models_router.router)
app.include_router(chat_router.router)
app.include_router(admin_router.router)
app.include_router(system_router.router)


@app.get("/health", tags=["system"], summary="健康检查")
async def health() -> dict:
    db_status = "ok"
    try:
        async with AsyncSessionLocal() as session:
            await session.execute(text("SELECT 1"))
    except Exception:
        db_status = "error"
        logger.exception("数据库健康检查失败", extra={"event": "health_db_failed"})

    return {
        "status": "ok" if db_status == "ok" else "degraded",
        "app": settings.app_name,
        "version": APP_VERSION,
        "env": settings.app_env,
        "db": db_status,
        "request_id": request_id_ctx.get(),
        "time": datetime.now(timezone.utc).isoformat(),
    }


# 仅开发环境暴露，用于验证错误处理链路，上线前删掉或自然会随 debug=False 消失
if settings.debug:

    @app.get("/health/boom", include_in_schema=False)
    async def health_boom():
        raise RuntimeError("故意抛出的测试异常")

    @app.get("/health/app-error", include_in_schema=False)
    async def health_app_error():
        raise AppError("CONV_NOT_FOUND")


# ---------- 生产托管：前端构建产物由 FastAPI 直接服务 ----------
FRONTEND_DIST = (BASE_DIR / settings.frontend_dist).resolve()
if (FRONTEND_DIST / "index.html").exists():
    assets_dir = FRONTEND_DIST / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa_fallback(full_path: str):
        if (
            full_path == "api"
            or full_path.startswith("api/")
            or full_path == "health"
            or full_path.startswith("health/")
        ):
            raise HTTPException(status_code=404, detail="Not Found")

        candidate = (FRONTEND_DIST / full_path).resolve()
        try:
            candidate.relative_to(FRONTEND_DIST)
        except ValueError:
            raise HTTPException(status_code=404, detail="Not Found")

        if full_path and candidate.is_file():
            return FileResponse(candidate)
        if "." in Path(full_path).name:
            raise HTTPException(status_code=404, detail="Not Found")
        return FileResponse(FRONTEND_DIST / "index.html")

    logger.info(
        "前端构建产物已托管",
        extra={"event": "frontend_dist_ready", "path": str(FRONTEND_DIST)},
    )
else:
    logger.info(
        "未找到前端构建产物，仅提供 API",
        extra={"event": "frontend_dist_missing", "path": str(FRONTEND_DIST)},
    )