"""密码哈希与 JWT 签发/校验。"""
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import bcrypt
import jwt

from app.config import get_settings

ALGORITHM = "HS256"

# bcrypt 只处理前 72 字节，超长会抛 ValueError，这里统一截断保持一致
_BCRYPT_MAX_BYTES = 72


def _prepare(raw: str) -> bytes:
    return raw.encode("utf-8")[:_BCRYPT_MAX_BYTES]


def hash_password(raw: str) -> str:
    return bcrypt.hashpw(_prepare(raw), bcrypt.gensalt()).decode("utf-8")


def verify_password(raw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(_prepare(raw), hashed.encode("utf-8"))
    except (ValueError, TypeError):
        return False


def create_access_token(*, user_id: int, role: str, token_version: int) -> tuple[str, int]:
    """返回 (token, 过期时间戳)。token 里带 ver，用于强制下线。"""
    settings = get_settings()
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(days=settings.access_token_expire_days)
    payload = {
        "sub": str(user_id),
        "role": role,
        "ver": token_version,
        # jti 用于登出黑名单，保证无状态 JWT 也能被单条撤销
        "jti": uuid.uuid4().hex,
        "iat": int(now.timestamp()),
        "exp": int(expires_at.timestamp()),
    }
    token = jwt.encode(payload, settings.secret_key, algorithm=ALGORITHM)
    return token, int(expires_at.timestamp())


def decode_access_token(token: str) -> dict[str, Any]:
    """校验失败会抛 jwt.ExpiredSignatureError / jwt.InvalidTokenError，由调用方翻译。"""
    settings = get_settings()
    return jwt.decode(token, settings.secret_key, algorithms=[ALGORITHM])
