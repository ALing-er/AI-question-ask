import json
import logging
import sys
from contextvars import ContextVar
from logging.handlers import TimedRotatingFileHandler
from pathlib import Path

# 由中间件写入，日志格式化时自动带上
request_id_ctx: ContextVar[str] = ContextVar("request_id", default="-")
user_id_ctx: ContextVar[str] = ContextVar("user_id", default="-")

TEXT_FORMAT = "%(asctime)s | %(levelname)-7s | %(request_id)s | %(user_id)s | %(name)s | %(message)s"

# logging 自带属性，导出 JSON 时要排除，否则输出一堆噪声
_RESERVED = {
    "name", "msg", "args", "levelname", "levelno", "pathname", "filename",
    "module", "exc_info", "exc_text", "stack_info", "lineno", "funcName",
    "created", "msecs", "relativeCreated", "thread", "threadName",
    "processName", "process", "taskName", "message", "asctime",
}


class ContextFilter(logging.Filter):
    """把 contextvar 里的 request_id / user_id 注入每条日志。"""

    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id_ctx.get()
        record.user_id = user_id_ctx.get()
        return True


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S"),
            "level": record.levelname,
            "logger": record.name,
            "request_id": getattr(record, "request_id", "-"),
            "user_id": getattr(record, "user_id", "-"),
            "message": record.getMessage(),
        }
        # 业务埋点：logger.info("chat_done", extra={"event": "chat_done", "tokens": 120})
        for key, value in record.__dict__.items():
            if key not in _RESERVED and key not in payload and not key.startswith("_"):
                payload[key] = value
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False)


def setup_logging(
    level: str = "INFO",
    log_dir: Path | str = "logs",
    retention_days: int = 14,
    json_mode: bool = False,
) -> None:
    log_path = Path(log_dir)
    log_path.mkdir(parents=True, exist_ok=True)

    formatter: logging.Formatter
    if json_mode:
        formatter = JsonFormatter()
    else:
        formatter = logging.Formatter(TEXT_FORMAT, datefmt="%Y-%m-%d %H:%M:%S", validate=False)

    console = logging.StreamHandler(sys.stdout)
    console.setFormatter(formatter)

    file_handler = TimedRotatingFileHandler(
        log_path / "app.log",
        when="midnight",
        backupCount=retention_days,
        encoding="utf-8",
    )
    file_handler.setFormatter(formatter)

    context_filter = ContextFilter()

    root = logging.getLogger()
    root.setLevel(level.upper())
    root.handlers.clear()
    for handler in (console, file_handler):
        handler.addFilter(context_filter)
        root.addHandler(handler)

    # 压掉噪声
    for noisy in ("uvicorn.access", "httpx", "httpcore"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
    logging.getLogger("uvicorn.error").setLevel(level.upper())


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)