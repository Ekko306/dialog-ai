"""第二张图：摘要助手（示例）。

演示第二个独立 graph 的完整结构：
- 自己的 State（与图①无关）
- 自己的 Context（运行时配置，每个助手可不同）
- 自己的节点与边
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict

from langgraph.graph import StateGraph
from langgraph.runtime import Runtime
from typing_extensions import TypedDict


class Context(TypedDict):
    """运行时可配置项，创建 assistant 或调用时可注入。"""

    summary_style: str  # 例如: brief / detailed


@dataclass
class State:
    """本图输入状态。"""

    text: str = ""


async def summarize(state: State, runtime: Runtime[Context]) -> Dict[str, Any]:
    """占位逻辑：改成真实的 LLM 调用即可。"""
    style = (runtime.context or {}).get("summary_style", "brief")
    return {"text": f"[{style}] 这是摘要示例结果，输入长度为 {len(state.text)}。"}


# 导出变量名固定为 graph，供 langgraph.json 引用
graph = (
    StateGraph(State, context_schema=Context)
    .add_node(summarize)
    .add_edge("__start__", "summarize")
    .compile(name="Summarizer")
)