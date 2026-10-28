"""OpenAI 兼容协议的流式调用。

火山方舟、DeepSeek、one-api 网关都兼容这套协议，所以只写一个实现，
差异（私有参数）通过 options / extra_body 透传。
"""
import json
from collections.abc import AsyncIterator
from typing import Any

import httpx

from app.errors import AppError
from app.logging_config import get_logger
from app.providers.base import ChatProvider, Chunk

logger = get_logger("app.provider")


class OpenAICompatibleProvider(ChatProvider):
    def __init__(
        self,
        *,
        base_url: str,
        connect_timeout: float = 10.0,
        total_timeout: float = 120.0,
        stream_options: dict[str, Any] | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout = httpx.Timeout(total_timeout, connect=connect_timeout)
        self.stream_options = stream_options or {}

    def _map_http_error(self, status: int, body: str) -> AppError:
        snippet = body[:300].replace("\n", " ")
        if status in (401, 403):
            return AppError("MODEL_KEY_INVALID", detail=snippet)
        if status == 429:
            return AppError("MODEL_RATE_LIMITED", detail=snippet)
        if status == 404:
            return AppError("MODEL_NOT_FOUND", detail=snippet)
        return AppError("MODEL_UPSTREAM_ERROR", detail=f"HTTP {status}: {snippet}")

    async def stream_chat(
        self,
        *,
        model_id: str,
        messages: list[dict[str, Any]],
        api_key: str,
        options: dict[str, Any] | None = None,
    ) -> AsyncIterator[Chunk]:
        payload: dict[str, Any] = {
            "model": model_id,
            "messages": messages,
            "stream": True,
        }
        if self.stream_options:
            payload["stream_options"] = self.stream_options
        if options:
            payload.update(options)

        url = f"{self.base_url}/chat/completions"
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
        }

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                async with client.stream("POST", url, headers=headers, json=payload) as resp:
                    if resp.status_code != 200:
                        body = (await resp.aread()).decode("utf-8", errors="replace")
                        logger.warning(
                            "上游返回错误",
                            extra={
                                "event": "upstream_http_error",
                                "status": resp.status_code,
                                "model": model_id,
                            },
                        )
                        raise self._map_http_error(resp.status_code, body)

                    async for line in resp.aiter_lines():
                        if not line or not line.startswith("data:"):
                            continue
                        data = line[len("data:"):].strip()
                        if not data:
                            continue
                        if data == "[DONE]":
                            break

                        try:
                            obj = json.loads(data)
                        except json.JSONDecodeError:
                            logger.debug("跳过无法解析的 SSE 行: %s", data[:120])
                            continue

                        # 有的厂商把 usage 单独放在最后一个 chunk
                        usage = obj.get("usage")
                        chunk_usage = None
                        if usage:
                            chunk_usage = {
                                "input_tokens": usage.get("prompt_tokens") or 0,
                                "output_tokens": usage.get("completion_tokens") or 0,
                            }

                        choices = obj.get("choices") or []
                        if not choices:
                            if chunk_usage:
                                yield Chunk(usage=chunk_usage)
                            continue

                        choice = choices[0]
                        delta = choice.get("delta") or {}
                        text = delta.get("content") or ""
                        reasoning = delta.get("reasoning_content") or ""

                        if text or reasoning or choice.get("finish_reason") or chunk_usage:
                            yield Chunk(
                                text=text,
                                reasoning=reasoning,
                                finish_reason=choice.get("finish_reason"),
                                usage=chunk_usage,
                            )
        except httpx.TimeoutException as exc:
            logger.warning("上游超时", extra={"event": "upstream_timeout", "model": model_id})
            raise AppError("MODEL_TIMEOUT", detail=str(exc)) from exc
        except httpx.HTTPError as exc:
            logger.warning("上游连接失败", extra={"event": "upstream_http_error", "model": model_id})
            raise AppError("MODEL_UPSTREAM_ERROR", detail=str(exc)) from exc
