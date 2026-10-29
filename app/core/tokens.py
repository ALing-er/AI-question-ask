"""粗略的 token 估算。

不同模型的分词器不一样，这里不引入 tiktoken（还要按模型下载词表），
只用「中文按 1 字 1 token、其他按 4 字符 1 token」估算，用于上下文预算够用。
"""
from __future__ import annotations


def _is_cjk(char: str) -> bool:
    code = ord(char)
    # CJK 统一表意文字、中文标点、全角字符
    return (
        0x4E00 <= code <= 0x9FFF
        or 0x3000 <= code <= 0x303F
        or 0xFF00 <= code <= 0xFFEF
    )


def estimate_tokens(text: str) -> int:
    if not text:
        return 0
    cjk = 0
    other = 0
    for char in text:
        if _is_cjk(char):
            cjk += 1
        else:
            other += 1
    # 其他字符按 4 个一组向上取整
    return cjk + (other + 3) // 4
