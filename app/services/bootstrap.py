"""启动引导：创建种子管理员。

为什么需要它：本期不提供"提升为管理员"的界面，管理员身份只来自种子账号。
所以必须有一个不依赖 UI 的创建入口，同时也是管理员密码丢失时的兜底。
"""
from sqlalchemy import select

from app.core.config import get_settings
from app.core.logging_setup import get_logger
from app.core.security import hash_password
from app.db import AsyncSessionLocal
from app.db.models import User

logger = get_logger("app.bootstrap")


async def ensure_seed_admin() -> None:
    settings = get_settings()

    if not settings.admin_password:
        logger.warning(
            "未配置 ADMIN_PASSWORD，跳过种子管理员创建",
            extra={"event": "seed_admin_skipped"},
        )
        return

    async with AsyncSessionLocal() as session:
        existing = await session.scalar(
            select(User).where(User.username == settings.admin_username)
        )
        if existing is not None:
            logger.info(
                "种子管理员已存在",
                extra={"event": "seed_admin_exists", "username": settings.admin_username},
            )
            return

        session.add(
            User(
                username=settings.admin_username,
                password_hash=hash_password(settings.admin_password),
                nickname="管理员",
                role="admin",
                status="active",
            )
        )
        await session.commit()

        logger.info(
            "已创建种子管理员",
            extra={"event": "seed_admin_created", "username": settings.admin_username},
        )
