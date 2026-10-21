"""英语表达润色模块的结构化输出定义。"""

from pydantic import BaseModel, Field


class PolishResult(BaseModel):
    """英语表达润色的结构化输出契约。"""

    original_text: str = Field(
        description="用户输入的原始英文，必须保持原样，不得改写。",
    )

    polished_text: str = Field(
        description=(
            "润色后的英文。重点改善表达的流畅度、自然度、"
            "习惯搭配、简洁性和语境适配度，同时保留原意。"
            "如果原文已经自然，则不需要强行修改。"
        ),
    )

    explanation: str = Field(
        description=(
            "使用简体中文解释实际修改的内容和原因。"
            "如果原文没有明显需要改进的地方，应说明无需修改。"
        ),
    )