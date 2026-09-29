"""第三张图：问答助手（示例）。

演示第三个独立 graph，并引入一个条件边（router）：
- 用一个节点判断问题类别，路由到不同处理节点
- 比前两张图多一个分支，展示多节点图结构
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Literal

from langgraph.graph import END, StateGraph
from langgraph.runtime import Runtime
from typing_extensions import TypedDict


class Context(TypedDict):
    """运行时可配置项。"""

    top_k: int  # 返回多少条答案


@dataclass
class State:
    question: str = ""
    category: str = ""
    answer: str = ""


async def classify(state: State, runtime: Runtime[Context]) -> Dict[str, Any]:
    """占位：按关键词粗判类别，可替换为 LLM 分类。"""
    q = state.question
    if any(k in q for k in ("总结", "摘要", "summar")):
        category = "summary"
    elif any(k in q for k in ("工具", "tool", "mcp")):
        category = "tools"
    else:
        category = "general"
    return {"category": category}


def route(state: State) -> Literal["answer_summary", "answer_tools", "answer_general"]:
    """条件路由：根据类别决定走向。"""
    return {"summary": "answer_summary", "tools": "answer_tools"}.get(
        state.category, "answer_general"
    )


async def answer_summary(state: State, runtime: Runtime[Context]) -> Dict[str, Any]:
    return {"answer": "文档摘要类回答示例。"}


async def answer_tools(state: State, runtime: Runtime[Context]) -> Dict[str, Any]:
    k = (runtime.context or {}).get("top_k", 3)
    return {"answer": f"工具类回答示例，top_k={k}。"}


async def answer_general(state: State, runtime: Runtime[Context]) -> Dict[str, Any]:
    return {"answer": "通用回答示例。"}


# 导出变量名固定为 graph，供 langgraph.json 引用
graph = (
    StateGraph(State, context_schema=Context)
    .add_node(classify)
    .add_node(answer_summary)
    .add_node(answer_tools)
    .add_node(answer_general)
    .add_edge("__start__", "classify")
    .add_conditional_edges("classify", route)
    .add_edge("answer_summary", END)
    .add_edge("answer_tools", END)
    .add_edge("answer_general", END)
    .compile(name="QA")
)