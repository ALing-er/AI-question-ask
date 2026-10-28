"""统一错误码与异常处理。

约定响应体（所有错误，含 422 校验错误与 500）：
{
  "error": {
    "code": "MODEL_KEY_INVALID",
    "message": "模型密钥无效",
    "request_id": "a1b2c3d4e5f6",
    "detail": null
  }
}
"""
from __future__ import annotations

from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.logging_config import get_logger, request_id_ctx

logger = get_logger("app.error")

# code -> (HTTP 状态码, 默认中文文案)
ERROR_CATALOG: dict[str, tuple[int, str]] = {
    # 认证 / 授权
    "AUTH_INVALID_CREDENTIALS": (401, "用户名或密码错误"),
    "AUTH_TOKEN_MISSING": (401, "未登录"),
    "AUTH_TOKEN_INVALID": (401, "登录状态无效，请重新登录"),
    "AUTH_TOKEN_EXPIRED": (401, "登录已过期，请重新登录"),
    "AUTH_TOKEN_REVOKED": (401, "登录状态已失效，请重新登录"),
    "AUTH_USER_DISABLED": (403, "账号已被停用"),
    "AUTH_FORBIDDEN": (403, "无权访问"),
    "AUTH_LOGIN_LOCKED": (429, "登录失败次数过多，账号已临时锁定"),
    "ADMIN_SELF_FORBIDDEN": (403, "不能对自己执行该操作"),
    "ADMIN_ADMIN_FORBIDDEN": (403, "不能删除管理员账号"),
    # 用户
    "USER_USERNAME_TAKEN": (409, "用户名已被占用"),
    "USER_WEAK_PASSWORD": (400, "密码至少 8 位"),
    "USER_NOT_FOUND": (404, "用户不存在"),
    # 会话
    "CONV_NOT_FOUND": (404, "会话不存在"),
    # 角色设定
    "PERSONA_NOT_FOUND": (404, "角色设定不存在"),
    # 模型
    "MODEL_NOT_FOUND": (404, "模型不存在或未启用"),
    "MODEL_KEY_MISSING": (500, "该模型未配置 API Key"),
    "MODEL_KEY_INVALID": (502, "模型密钥无效"),
    "MODEL_RATE_LIMITED": (429, "模型调用过于频繁，请稍后再试"),
    "MODEL_TIMEOUT": (504, "模型响应超时"),
    "MODEL_UPSTREAM_ERROR": (502, "模型服务异常"),
    # 语音
    "VOICE_KEY_MISSING": (500, "语音服务未配置 API Key"),
    "VOICE_KEY_INVALID": (502, "语音服务密钥无效"),
    "VOICE_NOT_FOUND": (404, "音色不存在或已删除"),
    "VOICE_DESIGN_FAILED": (502, "自定义音色生成失败"),
    "VOICE_TTS_FAILED": (502, "语音合成失败"),
    "VOICE_ASR_FAILED": (502, "语音识别失败"),
    "VOICE_AUDIO_TOO_LARGE": (413, "音频文件不能超过 10MB"),
    "VOICE_RATE_LIMITED": (429, "语音服务调用过于频繁"),
    # 系统
    "SYS_VALIDATION": (422, "请求参数有误"),
    "SYS_NOT_FOUND": (404, "接口不存在"),
    "SYS_HTTP_ERROR": (400, "请求无法处理"),
    "SYS_INTERNAL": (500, "服务器内部错误"),
}


class AppError(Exception):
    """业务异常。抛出它，由全局处理器统一转成标准 JSON。"""

    def __init__(
        self,
        code: str,
        message: str | None = None,
        *,
        detail: Any = None,
        status_code: int | None = None,
    ) -> None:
        status, default_message = ERROR_CATALOG.get(code, (500, "服务器内部错误"))
        self.code = code
        self.status_code = status_code or status
        self.message = message or default_message
        self.detail = detail
        super().__init__(self.message)


def build_error_body(code: str, message: str, detail: Any, request_id: str) -> dict[str, Any]:
    return {
        "error": {
            "code": code,
            "message": message,
            "request_id": request_id,
            "detail": detail,
        }
    }


def _log_error(code: str, status: int, **extra: Any) -> None:
    payload = {"event": "app_error", "code": code, "status": status, **extra}
    if status >= 500:
        logger.error("业务异常 %s", code, extra=payload)
    else:
        logger.warning("业务异常 %s", code, extra=payload)


def register_exception_handlers(app: FastAPI) -> None:
    """注册后会覆盖 FastAPI 的默认错误响应形状。"""

    @app.exception_handler(AppError)
    async def _handle_app_error(request: Request, exc: AppError) -> JSONResponse:
        rid = request_id_ctx.get()
        _log_error(exc.code, exc.status_code, path=request.url.path)
        return JSONResponse(
            status_code=exc.status_code,
            content=build_error_body(exc.code, exc.message, exc.detail, rid),
        )

    @app.exception_handler(RequestValidationError)
    async def _handle_validation_error(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        rid = request_id_ctx.get()
        detail = [
            {"field": ".".join(str(p) for p in err.get("loc", [])), "msg": err.get("msg", "")}
            for err in exc.errors()
        ]
        logger.warning("参数校验失败", extra={"event": "validation_error", "path": request.url.path})
        return JSONResponse(
            status_code=422,
            content=build_error_body("SYS_VALIDATION", "请求参数有误", detail, rid),
        )

    @app.exception_handler(StarletteHTTPException)
    async def _handle_http_exception(
        request: Request, exc: StarletteHTTPException
    ) -> JSONResponse:
        rid = request_id_ctx.get()
        code = "SYS_NOT_FOUND" if exc.status_code == 404 else "SYS_HTTP_ERROR"
        default_message = ERROR_CATALOG[code][1]
        # 404 统一用中文文案（框架默认给的是 "Not Found"）；
        # 其余如 405 保留框架 detail，便于定位
        if exc.status_code == 404:
            message = default_message
        else:
            message = exc.detail if isinstance(exc.detail, str) else default_message
        status = exc.status_code if 400 <= exc.status_code < 600 else 400
        _log_error(code, status, path=request.url.path)
        return JSONResponse(
            status_code=status,
            content=build_error_body(code, message, None, rid),
        )