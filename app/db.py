"""数据库引擎与会话管理。

- SQLite 路径统一解析成绝对路径，避免"在哪个目录启动"导致库跑偏
- PRAGMA foreign_keys / WAL 在每次连接时设置
"""
from collections.abc import AsyncIterator
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import DateTime, TypeDecorator, delete, event, inspect, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import BASE_DIR, get_settings

settings = get_settings()

_SQLITE_PREFIX = "sqlite+aiosqlite:///"


def _resolve_sqlite_url(url: str) -> str:
    """把相对路径的 SQLite URL 解析成绝对路径，并确保目录存在。"""
    if not url.startswith(_SQLITE_PREFIX):
        return url
    raw = url[len(_SQLITE_PREFIX):]
    if not raw or raw == ":memory:":
        return url
    path = Path(raw)
    if not path.is_absolute():
        path = (BASE_DIR / path).resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    return _SQLITE_PREFIX + path.as_posix()


DATABASE_URL = _resolve_sqlite_url(settings.database_url)

engine = create_async_engine(DATABASE_URL, echo=False, pool_pre_ping=True)


@event.listens_for(engine.sync_engine, "connect")
def _set_sqlite_pragmas(dbapi_connection, _connection_record) -> None:
    cursor = dbapi_connection.cursor()
    try:
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA busy_timeout=5000")
    finally:
        cursor.close()


class Base(DeclarativeBase):
    pass


class UTCDateTime(TypeDecorator):
    """SQLite 不保存时区，读出来是裸 datetime，接口会少一个 +00:00。

    这里统一：写入时转成 UTC 存储，读取时补上 UTC 时区，
    这样子类拿到的一定是 aware datetime，序列化出来自带偏移。
    """

    impl = DateTime
    cache_ok = True

    def process_bind_param(self, value: datetime | None, dialect):
        if value is None:
            return None
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc).replace(tzinfo=None)

    def process_result_value(self, value: datetime | None, dialect):
        if value is None:
            return None
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)


AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)


async def get_session() -> AsyncIterator[AsyncSession]:
    """FastAPI 依赖：每个请求一个独立 session。"""
    async with AsyncSessionLocal() as session:
        yield session


def _migrate_sqlite(sync_conn) -> None:
    """给已有 SQLite 表补列。

    create_all 只会建新表，不会修改旧表；这里用 ALTER TABLE 做幂等补列，
    避免升级后旧库报 "no such column"。
    """
    if sync_conn.dialect.name != "sqlite":
        return

    inspector = inspect(sync_conn)
    tables = set(inspector.get_table_names())

    def columns_of(table: str) -> set[str]:
        return {col["name"] for col in inspector.get_columns(table)}

    if "users" in tables:
        cols = columns_of("users")
        if "failed_login_attempts" not in cols:
            sync_conn.execute(
                text(
                    "ALTER TABLE users "
                    "ADD COLUMN failed_login_attempts INTEGER NOT NULL DEFAULT 0"
                )
            )
        if "locked_until" not in cols:
            sync_conn.execute(text("ALTER TABLE users ADD COLUMN locked_until DATETIME"))

    if "conversations" in tables:
        cols = columns_of("conversations")
        if "system_prompt" not in cols:
            sync_conn.execute(text("ALTER TABLE conversations ADD COLUMN system_prompt TEXT"))
        if "voice_type" not in cols:
            sync_conn.execute(text("ALTER TABLE conversations ADD COLUMN voice_type VARCHAR(128)"))
        if "voice_prompt" not in cols:
            sync_conn.execute(text("ALTER TABLE conversations ADD COLUMN voice_prompt TEXT"))

    if "personas" in tables:
        cols = columns_of("personas")
        if "voice_type" not in cols:
            sync_conn.execute(text("ALTER TABLE personas ADD COLUMN voice_type VARCHAR(128)"))
        if "voice_prompt" not in cols:
            sync_conn.execute(text("ALTER TABLE personas ADD COLUMN voice_prompt TEXT"))

    if "messages" in tables:
        cols = columns_of("messages")
        if "reasoning" not in cols:
            sync_conn.execute(text("ALTER TABLE messages ADD COLUMN reasoning TEXT"))

    # 旧的系统音色只保留默认音色；其余值若不是自定义音色则清空
    if "custom_voices" in tables:
        cleanup_sql = (
            "UPDATE {table} SET voice_type = NULL "
            "WHERE voice_type IS NOT NULL "
            "AND voice_type != :default_voice "
            "AND voice_type NOT IN (SELECT voice_id FROM custom_voices)"
        )
        if "conversations" in tables:
            sync_conn.execute(
                text(cleanup_sql.format(table="conversations")),
                {"default_voice": settings.default_voice_type},
            )
        if "personas" in tables:
            sync_conn.execute(
                text(cleanup_sql.format(table="personas")),
                {"default_voice": settings.default_voice_type},
            )


async def init_db() -> None:
    """建表 + 补列（幂等）。需要先 import models，否则 metadata 是空的。"""
    from app import models  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.run_sync(_migrate_sqlite)


async def cleanup_revoked_tokens() -> None:
    """清理已过期的登出黑名单记录。"""
    from app.models import RevokedToken

    now = datetime.now(timezone.utc)
    async with AsyncSessionLocal() as session:
        await session.execute(delete(RevokedToken).where(RevokedToken.expires_at < now))
        await session.commit()


async def dispose_db() -> None:
    await engine.dispose()
