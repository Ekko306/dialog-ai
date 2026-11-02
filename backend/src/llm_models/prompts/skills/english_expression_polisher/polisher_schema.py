"""英语表达润色模块的结构化输出定义。"""

from pydantic import BaseModel, Field


class StylePolish(BaseModel):
    """单一风格的润色块（003 弹窗三风格，Q1 决策 A：一次生成三种风格）。"""

    polished_text: str = Field(description="该风格下的润色后英文")

    explanation: str = Field(
        description="该风格改写的简体中文修改解释（改了什么、为什么更符合该风格）",
    )


class PolishResult(BaseModel):
    """英语表达润色的结构化输出契约。"""

    original_text: str = Field(
        description="用户输入的原始英文，必须保持原样，不得改写。",
    )

    # 以下三字段 = 地道美式默认风格（语义与既有契约保持不变）
    polished_text: str = Field(
        description=(
            "地道美式风格（默认主风格）的润色后英文。重点改善表达的流畅度、自然度、"
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

    style_business: StylePolish | None = Field(
        default=None,
        description=(
            "商务正式风格：职场/正式场合的得体表达（用词正式、句式稳重）。"
            "该风格下原文已足够得体或确实无法生成时为 null，不要编造。"
        ),
    )

    style_british: StylePolish | None = Field(
        default=None,
        description=(
            "地道英式风格：英式习惯表达（英式用词/说法）。"
            "该风格下原文已足够地道或确实无法生成时为 null，不要编造。"
        ),
    )