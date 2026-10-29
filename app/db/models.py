"""ORM 模型：User / Conversation / Message。"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import JSON, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base, UTCDateTime


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(32), unique=True, index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    nickname: Mapped[str | None] = mapped_column(String(64))
    # user | admin
    role: Mapped[str] = mapped_column(String(16), default="user", nullable=False)
    # active | disabled
    status: Mapped[str] = mapped_column(String(16), default="active", nullable=False)
    # 登录态版本号：管理员禁用用户时 +1，旧 token 立即失效
    token_version: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    # 登录失败次数与临时锁定时间
    failed_login_attempts: Mapped[int] = mapped_column(
        Integer, default=0, nullable=False
    )
    locked_until: Mapped[datetime | None] = mapped_column(UTCDateTime())
    created_at: Mapped[datetime] = mapped_column(
        UTCDateTime(), default=now_utc, nullable=False
    )
    last_login_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    deleted_at: Mapped[datetime | None] = mapped_column(UTCDateTime())

    conversations: Mapped[list[Conversation]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<User id={self.id} username={self.username} role={self.role}>"


class Persona(Base):
    """用户保存的角色设定，可重复应用到不同会话。"""

    __tablename__ = "personas"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    prompt: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(String(255))
    # 音色：百炼 TTS 的 voice 参数；为空时使用默认音色
    voice_type: Mapped[str | None] = mapped_column(String(128))
    # 音色描述提示词，用于记录期望的音色特征
    voice_prompt: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        UTCDateTime(), default=now_utc, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        UTCDateTime(), default=now_utc, onupdate=now_utc, nullable=False
    )
    deleted_at: Mapped[datetime | None] = mapped_column(UTCDateTime())

    __table_args__ = (Index("ix_personas_user_updated", "user_id", "updated_at"),)


class CustomVoice(Base):
    """用户通过百炼声音设计生成的自定义音色。"""

    __tablename__ = "custom_voices"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    voice_id: Mapped[str] = mapped_column(
        String(128), unique=True, index=True, nullable=False
    )
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    prompt: Mapped[str] = mapped_column(Text, nullable=False)
    target_model: Mapped[str] = mapped_column(String(64), nullable=False)
    preview_text: Mapped[str | None] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(
        UTCDateTime(), default=now_utc, nullable=False
    )
    deleted_at: Mapped[datetime | None] = mapped_column(UTCDateTime())

    __table_args__ = (
        Index("ix_custom_voices_user_created", "user_id", "created_at"),
    )


class Conversation(Base):
    __tablename__ = "conversations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    title: Mapped[str] = mapped_column(String(100), default="新会话", nullable=False)
    # 会话默认模型；具体某条消息以 messages.model_id 为准
    model_id: Mapped[str] = mapped_column(String(64), nullable=False)
    # 会话级系统提示词 / 人设；为空时使用全局默认值
    system_prompt: Mapped[str | None] = mapped_column(Text)
    # 会话级音色与音色描述
    voice_type: Mapped[str | None] = mapped_column(String(128))
    voice_prompt: Mapped[str | None] = mapped_column(Text)
    # 早期对话的滚动摘要；summary_until_id 表示已被摘要到的消息 id
    summary: Mapped[str | None] = mapped_column(Text)
    summary_until_id: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        UTCDateTime(), default=now_utc, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        UTCDateTime(), default=now_utc, onupdate=now_utc, nullable=False
    )
    deleted_at: Mapped[datetime | None] = mapped_column(UTCDateTime())

    user: Mapped[User] = relationship(back_populates="conversations")
    messages: Mapped[list[Message]] = relationship(
        back_populates="conversation",
        cascade="all, delete-orphan",
        order_by="Message.id",
    )

    __table_args__ = (
        # 会话列表页的核心查询：where user_id = ? order by updated_at desc
        Index("ix_conversations_user_updated", "user_id", "updated_at"),
    )

    def __repr__(self) -> str:
        return f"<Conversation id={self.id} user_id={self.user_id} title={self.title}>"


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    conversation_id: Mapped[int] = mapped_column(
        ForeignKey("conversations.id", ondelete="CASCADE"), index=True, nullable=False
    )
    # user | assistant | system
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    content: Mapped[str] = mapped_column(Text, default="", nullable=False)
    # 推理模型的思考过程，仅用于展示与历史回放
    reasoning: Mapped[str | None] = mapped_column(Text)
    model_id: Mapped[str | None] = mapped_column(String(64))
    input_tokens: Mapped[int | None] = mapped_column(Integer)
    output_tokens: Mapped[int | None] = mapped_column(Integer)
    latency_ms: Mapped[int | None] = mapped_column(Integer)
    # streaming | done | aborted | error
    status: Mapped[str] = mapped_column(String(16), default="done", nullable=False)
    # 预留多模态，本期恒为 NULL
    attachments: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(
        UTCDateTime(), default=now_utc, nullable=False
    )

    conversation: Mapped[Conversation] = relationship(back_populates="messages")

    __table_args__ = (
        Index("ix_messages_conversation_created", "conversation_id", "created_at"),
    )

    def __repr__(self) -> str:
        return f"<Message id={self.id} role={self.role} status={self.status}>"


class RevokedToken(Base):
    """已登出的 JWT 黑名单。

    JWT 本身无状态，登出后靠这张表让当前 token 立即失效；
    过期记录会在应用启动时清理。
    """

    __tablename__ = "revoked_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    jti: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime(), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        UTCDateTime(), default=now_utc, nullable=False
    )


class AuditLog(Base):
    """审计日志：只记录操作，不记录聊天正文、密码或 token。"""

    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # 不设外键，用户被删除后审计记录仍然保留
    actor_id: Mapped[int | None] = mapped_column(Integer)
    actor_username: Mapped[str] = mapped_column(String(64), default="-", nullable=False)
    action: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    target_type: Mapped[str | None] = mapped_column(String(32))
    target_id: Mapped[str | None] = mapped_column(String(64))
    detail: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    ip: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(
        UTCDateTime(), default=now_utc, nullable=False
    )

    __table_args__ = (Index("ix_audit_logs_created", "created_at"),)
