"""grammar_check 的 LLM 输出契约（PR 评审意见：与子图逻辑无关的契约单独成文件）。

只放 ChatDeepSeek.with_structured_output 使用的 Pydantic 模型，
不含任何图运行时逻辑：
- 图状态 schema → src/talk_agent/state.py 的 GrammarCheckState
- 子图节点实现 / 图构建 → grammar_check_subgraph.py
"""

from typing import Literal

from pydantic import BaseModel, Field


# ========== 运行状态枚举（类型层） ==========

# grammar_check_status 的取值域：运行时就是普通字符串（Literal 不改变值本身），
# LangGraph 路由 / checkpointer 序列化 / 日志格式化零影响
GrammarCheckStatus = Literal["ok", "empty_input", "invalid_input", "unavailable"]


class GrammarIssue(BaseModel):
    """单个语法错误的定位标记——只标记不纠错，纠错由下游 grammar_tutor 负责。"""

    fragment: str = Field(description="出错的原文片段，用于定位错误位置")
    error_type: str = Field(description="错误类型：时态/主谓一致/单复数/词性误用等")
    description: str = Field(description="中文简述错在哪里；禁止给出正确答案或改写后的句子")


class GrammarVerdict(BaseModel):
    """LLM 结构化输出契约：语法检查结果（只检测标记，不纠错）。

    只描述"LLM 应该返回什么"，不包含图运行时字段
    （grammar_check_status 等由节点逻辑决定，不由 LLM 决定）。
    """

    has_issue: bool = Field(
        description=(
            "句子是否存在真正的语法错误（时态、主谓一致、单复数、词性误用等）。"
            "语法正确但表达不够自然不算语法错误。"
        )
    )
    issues: list[GrammarIssue] = Field(
        description="每处语法错误的定位标记（位置/类型/简述）；无错误时为空列表。"
    )
    feedback: str = Field(
        description=(
            "面向学习者的中文一句话概述（有哪些类型的错误）；"
            "禁止给出正确答案或修改后的句子；无错误时为空字符串。"
        )
    )
