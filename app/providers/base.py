"""Provider 抽象：所有厂商的流式输出都归一化成 Chunk。"""
from dataclasses import dataclass
from typing import Any


@dataclass(slots=True)
class Chunk:
    """上游返回的一个增量片段。

    不同厂商字段名不一样（content / delta.text / reasoning_content），
    适配层负责统一，上层只认这三个字段。
    """

    text: str = ""
    reasoning: str = ""
    finish_reason: str | None = None
    usage: dict[str, int] | None = None


class ChatProvider:
    """所有 provider 的接口。新增厂商只需实现 stream_chat。"""

    name: str = "base"

    async def stream_chat(
        self,
        *,
        model_id: str,
        messages: list[dict[str, Any]],
        api_key: str,
        options: dict[str, Any] | None = None,
    ):
        raise NotImplementedError
