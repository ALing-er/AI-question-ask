"""请求/响应数据模型。"""
import re
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

USERNAME_RE = re.compile(r"^[A-Za-z0-9_]{3,20}$")


class RegisterRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=20, examples=["alice"])
    password: str = Field(..., min_length=8, max_length=64, examples=["Test@1234"])
    nickname: str | None = Field(default=None, max_length=64)

    @field_validator("username")
    @classmethod
    def _check_username(cls, value: str) -> str:
        if not USERNAME_RE.match(value):
            raise ValueError("用户名只能包含字母、数字和下划线，长度 3-20")
        return value


class LoginRequest(BaseModel):
    username: str = Field(..., max_length=32)
    password: str = Field(..., max_length=64)


class ChangePasswordRequest(BaseModel):
    old_password: str = Field(..., max_length=64)
    new_password: str = Field(..., min_length=8, max_length=64)


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    nickname: str | None
    role: str
    status: str
    created_at: datetime
    last_login_at: datetime | None


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_at: int
    user: UserOut


# ---------------- 会话 ----------------


class ConversationCreate(BaseModel):
    title: str | None = Field(default=None, max_length=100)
    model_id: str | None = Field(default=None, max_length=64)
    system_prompt: str | None = Field(default=None, max_length=4000)
    voice_type: str | None = Field(default=None, max_length=128)
    voice_prompt: str | None = Field(default=None, max_length=2000)


class ConversationUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=100)
    model_id: str | None = Field(default=None, min_length=1, max_length=64)
    # 传空字符串表示清除会话级人设
    system_prompt: str | None = Field(default=None, max_length=4000)
    voice_type: str | None = Field(default=None, max_length=128)
    voice_prompt: str | None = Field(default=None, max_length=2000)


class ConversationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    model_id: str
    system_prompt: str | None
    voice_type: str | None
    voice_prompt: str | None
    created_at: datetime
    updated_at: datetime


class MessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    role: str
    content: str
    reasoning: str | None
    model_id: str | None
    status: str
    input_tokens: int | None
    output_tokens: int | None
    latency_ms: int | None
    created_at: datetime


# ---------------- 角色设定 ----------------


class PersonaCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=64)
    prompt: str = Field(..., min_length=1, max_length=4000)
    description: str | None = Field(default=None, max_length=255)
    voice_type: str | None = Field(default=None, max_length=128)
    voice_prompt: str | None = Field(default=None, max_length=2000)


class PersonaUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=64)
    prompt: str | None = Field(default=None, min_length=1, max_length=4000)
    description: str | None = Field(default=None, max_length=255)
    voice_type: str | None = Field(default=None, max_length=128)
    voice_prompt: str | None = Field(default=None, max_length=2000)


class PersonaOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    prompt: str
    description: str | None
    voice_type: str | None
    voice_prompt: str | None
    created_at: datetime
    updated_at: datetime


class BeautifyPromptRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=4000)


class BeautifyPromptResponse(BaseModel):
    prompt: str


class VoicePromptRequest(BaseModel):
    role_prompt: str = Field(..., min_length=1, max_length=4000)
    current_prompt: str | None = Field(default=None, max_length=2000)


class VoicePromptResponse(BaseModel):
    prompt: str


class VoiceDesignRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=64)
    prompt: str = Field(..., min_length=1, max_length=500)
    preview_text: str | None = Field(default=None, min_length=15, max_length=200)


class VoiceOptionOut(BaseModel):
    id: int | None = None
    value: str
    label: str
    gender: str = ""
    description: str = ""
    kind: str = "custom"


class VoiceDesignResponse(BaseModel):
    voice: VoiceOptionOut
    preview_audio: str
    preview_format: str = "wav"


# ---------------- 对话 ----------------


class ChatRequest(BaseModel):
    conversation_id: int
    # 真正的长度上限由 MAX_MESSAGE_CHARS 配置在路由里校验
    content: str = Field(..., min_length=1, max_length=100_000)
    # 不传则用会话的默认模型
    model_id: str | None = Field(default=None, max_length=64)


# ---------------- 管理后台 ----------------


class AdminUserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    nickname: str | None
    role: str
    status: str
    created_at: datetime
    last_login_at: datetime | None
    conversation_count: int = 0
    message_count: int = 0


class AdminUserList(BaseModel):
    items: list[AdminUserOut]
    total: int


class AdminUserUpdate(BaseModel):
    status: Literal["active", "disabled"] | None = None


class AdminResetPasswordRequest(BaseModel):
    new_password: str = Field(..., min_length=8, max_length=64)


class AdminStats(BaseModel):
    total_users: int
    active_users: int
    disabled_users: int
    total_conversations: int
    total_messages: int
    today_messages: int


class AuditLogOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    actor_username: str
    action: str
    target_type: str | None
    target_id: str | None
    detail: dict[str, Any] | None
    ip: str | None
    created_at: datetime


class AuditLogList(BaseModel):
    items: list[AuditLogOut]
    total: int
