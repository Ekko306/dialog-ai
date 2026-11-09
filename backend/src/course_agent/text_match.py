"""跟读比对（纯函数，无副作用，可单测）.

规则（spec FR-006 / research R6）：归一化后完全相等即通过。
归一化 = 去首尾空白 → 转小写 → 去撇号 → 去中英文标点 → 连续空白压成单空格。
"""

from __future__ import annotations

import re

# 撇号先直接删除（不替换成空格）：语音转写常把 "I'm" 输出成 "im"，
# 若替换成空格会得到 "i m" 而误判不通过。
_APOSTROPHE = re.compile(r"[’'`]")
# 其余英文标点 + 中文标点（保留字母、数字、空白与下划线外的保留字符）
_PUNCT = re.compile(r"[^\w\s]|[_]", flags=re.UNICODE)
_SPACES = re.compile(r"\s+")


def normalize(text: str) -> str:
    """归一化文本用于比对；空输入返回空串。"""
    if not isinstance(text, str):
        return ""
    lowered = text.strip().lower()
    no_quote = _APOSTROPHE.sub("", lowered)
    stripped = _PUNCT.sub(" ", no_quote)
    return _SPACES.sub(" ", stripped).strip()


def is_match(user_input: str, target: str) -> bool:
    """用户输入是否与目标句一致（忽略大小写、标点、多余空白）。"""
    return normalize(user_input) == normalize(target)
