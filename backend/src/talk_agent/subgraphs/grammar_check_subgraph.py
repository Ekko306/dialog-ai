"""grammar_check 子图：语法检查模块（ LangGraph 官网规范结构）。

职责边界：
- 只接收上游父图节点（xfyun_ita_tool_node）产出的 raw_text 纯文本；
  语音识别与 ISE 评测由上游完成，不在本子图内
- 只检测硬语法错误（时态/主谓一致/单复数/词性误用），
  语法正确但不自然的表达留给润色模块（polisher）
- 输出结构化契约字段（has_issue/issues/feedback），只检测标记不纠错：
  纠错由下游 grammar_tutor 负责，本子图严禁给出正确答案

容错分层（RetryPolicy 与异常传播的约定）：
- 瞬态错误（连接失败/超时/5xx）→ 节点内上抛，RetryPolicy 指数退避重试
- 非瞬态错误（如 401 认证失败）→ 就地转 grammar_check_status="unavailable"
- 输入异常（空/超长）→ empty_input / invalid_input，不伪装成 has_issue=False
"""

import os
import sys
from pathlib import Path

# 兼容直接运行本文件：把 backend 目录加入 sys.path；
# langgraph dev / uv run 下 backend 本就在 sys.path，无副作用
_BACKEND_DIR = Path(__file__).resolve().parents[3]  # subgraphs 比 graph.py 深一层
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from operator import add
from typing import Annotated, TypedDict

from dotenv import load_dotenv
from pydantic import BaseModel, Field
from langchain.messages import SystemMessage, HumanMessage
from langchain_deepseek import ChatDeepSeek
from langgraph.graph import StateGraph, START, END
from langgraph.types import RetryPolicy  # langgraph 1.x 中 RetryPolicy 位于 langgraph.types

# 复用 backend/.env（backend/src/talk_agent/subgraphs → parents[3] = backend）
load_dotenv(_BACKEND_DIR / ".env")

# ========== Schema 定义 ==========


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


class GrammarCheckState(TypedDict, total=False):
    """grammar_check 子图的状态 schema。

    与 GrammarVerdict 分开定义的原因：
    GrammarVerdict 是 LLM 的输出契约；Graph State 还要承载
    运行状态（grammar_check_status）和日志等图运行时字段。
    """

    # 输入
    raw_text: str

    # 检查结果（由 grammar_check_node 从 GrammarVerdict 写入；只标记不纠错）
    has_issue: bool
    issues: list[dict]  # 每处错误 {fragment, error_type, description}
    feedback: str  # 错误简短概述（不含正确答案，纠错归下游 tutor）

    # 运行状态：ok / empty_input / invalid_input / unavailable
    grammar_check_status: str

    # 日志：add 累积；字段名独立于父图 logger，避免父子 reducer 冲突
    grammar_check_logs: Annotated[list[str], add]


# ========== 模型配置（checker 依赖 GrammarVerdict） ==========

# ChatDeepSeek 在构造时就会校验 api_key，
# 所以没配置 key 时不建模型，让节点走 unavailable 降级路径
_api_key = os.getenv("DEEPSEEK_API_KEY")
if _api_key:
    model = ChatDeepSeek(
        model=os.getenv("DEEPSEEK_MODEL", "deepseek-chat"),
        api_key=_api_key,
        temperature=0,  # 语法判定要稳定，不要创造性
    )
    checker = model.with_structured_output(GrammarVerdict)  # 强制按 Schema 返回
else:
    model = None
    checker = None
    print("[警告] 未配置 DEEPSEEK_API_KEY，语法检查将降级为 unavailable")

GRAMMAR_CHECK_PROMPT = (
    "你是英语语法检查助手，只负责检测和标记用户句子中的语法错误，不要纠错。规则：\n"
    "1. 只判定语法错误：时态、主谓一致、单复数、词性误用等。\n"
    "2. 语法正确但表达不自然的句子不算语法错误，例如 'I agree with you.' 没有语法错误。\n"
    "3. 每处错误标记三要素：fragment=出错的原文片段、error_type=错误类型、description=中文简述错在哪。\n"
    "4. 严禁给出正确答案或修改后的句子（哪怕一个词）——纠错由下游 grammar_tutor 节点负责。\n"
    "5. feedback 只用一句话概述错误类型，同样不含任何正确写法。\n"
    "6. 无语法错误时：has_issue=False，issues 为空列表，feedback 为空字符串。"
)

# ========== 节点 ==========

MAX_TEXT_LENGTH = 500  # 输入长度上限：超过视为无效输入


def _is_transient(e: Exception) -> bool:
    """判断是否为"瞬态"系统异常——重试有机会成功的错误。

    重试：连接失败、超时、服务端 5xx（duck-typing 读 status_code，
    兼容 openai/httpx 异常，无需导入具体类型）
    不重试：401 认证失败、400 参数错误等客户端错误（重试也不会好）
    """
    if isinstance(e, (ConnectionError, TimeoutError)):
        return True
    status = getattr(e, "status_code", None)
    return isinstance(status, int) and status >= 500


def grammar_check_node(state: GrammarCheckState) -> GrammarCheckState:
    raw_text = state.get("raw_text", "")

    # 出口1：空文本——根本没有完成有效检查，
    # 不能返回 has_issue=False（那会被父图理解成"没有语法问题"）
    if not raw_text.strip():
        return {
            "grammar_check_status": "empty_input",
            "grammar_check_logs": ["grammar_check_node：输入为空 → empty_input"],
        }

    # 出口2：超长文本
    if len(raw_text) > MAX_TEXT_LENGTH:
        return {
            "grammar_check_status": "invalid_input",
            "grammar_check_logs": [
                f"grammar_check_node：输入超长({len(raw_text)}>{MAX_TEXT_LENGTH}) → invalid_input"
            ],
        }

    # 出口3：正常输入——调用 LLM 结构化输出做语法检查
    if checker is None:
        return {
            "grammar_check_status": "unavailable",
            "grammar_check_logs": [
                "grammar_check_node：未配置 DEEPSEEK_API_KEY → unavailable"
            ],
        }

    try:
        verdict: GrammarVerdict = checker.invoke(
            [
                SystemMessage(content=GRAMMAR_CHECK_PROMPT),
                HumanMessage(content=raw_text),
            ]
        )
    except Exception as e:
        # 分层容错：异常必须"能传播出去"RetryPolicy 才有机会重试——
        # 如果这里全部吞掉转 unavailable，重试机制就永远不会触发
        if _is_transient(e):
            raise  # 瞬态异常(连接失败/超时/5xx)上抛 → RetryPolicy 指数退避重试；
            #        3次耗尽后异常继续上抛，由调用方(Gateway层)最终兜底
        return {  # 非瞬态错误(如401认证失败)重试也不会好 → 直接 unavailable
            "grammar_check_status": "unavailable",
            "grammar_check_logs": [
                f"grammar_check_node：LLM 调用失败({type(e).__name__}: {e}) → unavailable"
            ],
        }

    return {
        "grammar_check_status": "ok",
        "has_issue": verdict.has_issue,
        "issues": [issue.model_dump() for issue in verdict.issues],
        "feedback": verdict.feedback,
        "grammar_check_logs": ["grammar_check_node：LLM 语法检查完成（只标记不纠错）"],
    }


# ========== 构建子图 ==========
builder = StateGraph(state_schema=GrammarCheckState)
# RetryPolicy = 系统异常重试：只重试 _is_transient 认定的瞬态错误，
# 与"用户答错/检查出问题"的正常学习循环完全无关，不要混淆两条路径
builder.add_node(
    "grammar_check_node",
    grammar_check_node,
    retry_policy=RetryPolicy(
        max_attempts=3,
        backoff_factor=2.0,
        initial_interval=1.0,
        retry_on=_is_transient,
    ),
)

builder.add_edge(START, "grammar_check_node")
builder.add_edge("grammar_check_node", END)

grammar_check_subgraph = builder.compile()

if __name__ == "__main__":
    # stream_mode="updates"：逐节点打印状态写入（终端可观测方案）
    for text in ["She go to school every day.", "I agree with you.", ""]:
        print(f"\n{'=' * 60}")
        print(f"输入: {text!r}")
        print("=" * 60)
        for step in grammar_check_subgraph.stream({"raw_text": text}, stream_mode="updates"):
            for node_name, update in step.items():
                print(f"\n--- 节点 [{node_name}] 写入的状态 ---")
                for key, value in update.items():
                    print(f"  {key} = {value!r}")
