from functools import lru_cache
from pathlib import Path

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent
DEFAULT_SECRET = "please-generate-a-random-string"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BASE_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # 应用
    app_name: str = "AI QA Platform"
    app_env: str = "dev"
    debug: bool = True
    secret_key: str = DEFAULT_SECRET
    access_token_expire_days: int = 7

    # 数据库
    database_url: str = "sqlite+aiosqlite:///./data/app.db"

    # 账号
    allow_registration: bool = True
    admin_username: str = "admin"
    admin_password: str = ""

    # 模型
    ark_api_key: str = ""
    deepseek_api_key: str = ""
    bailian_api_key: str = ""

    # 跨域
    cors_origins: str = "http://localhost:5173"

    # 日志
    log_level: str = "INFO"
    log_dir: str = "logs"
    log_retention_days: int = 14

    # 对话
    max_context_turns: int = 10
    max_context_chars: int = 24000
    max_message_chars: int = 8000
    default_model_id: str = "deepseek-chat"
    default_system_prompt: str = ""
    # 提示词美化使用的模型
    persona_model_id: str = "deepseek-chat"
    upstream_connect_timeout: float = 10.0
    upstream_total_timeout: float = 120.0

    # 登录保护
    login_max_attempts: int = 5
    login_lock_minutes: int = 15

    # 前端构建产物（生产环境由 FastAPI 托管）
    frontend_dist: str = "frontend/dist"

    @property
    def is_prod(self) -> bool:
        return self.app_env.lower() == "prod"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def log_path(self) -> Path:
        return BASE_DIR / self.log_dir

    @model_validator(mode="after")
    def _check_prod_security(self) -> "Settings":
        if self.is_prod:
            if self.secret_key == DEFAULT_SECRET or len(self.secret_key) < 32:
                raise ValueError("生产环境必须设置 32 位以上的 SECRET_KEY")
            if not self.admin_password:
                raise ValueError("生产环境必须设置 ADMIN_PASSWORD")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()