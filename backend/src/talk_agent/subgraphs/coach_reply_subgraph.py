import sys
from pathlib import Path

# 兼容直接运行本文件：把 backend 目录加入 sys.path，使 src.* 绝对导入可用；
# langgraph dev / uv run 下 backend 本就在 sys.path，无副作用
_BACKEND_DIR = Path(__file__).resolve().parents[3]  # subgraphs 比 graph.py 深一层
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from langgraph.graph import StateGraph, START, END  # noqa: E402
from langgraph.runtime import Runtime  # noqa: E402
from langgraph.types import interrupt  # noqa: E402

from src.talk_agent.state import SubgraphState  # noqa: E402
from src.talk_agent.coach_context import (  # noqa: E402
    CoachContext,
)
from src.llm_models.coach_model import (get_coach_model, NEW_DIALOG_START)
from langchain_core.messages import HumanMessage
from typing import Literal  # noqa: E402

from src.talk_agent.coach_context import (  # noqa: E402
    DEFAULT_ROLE,
    DEFAULT_SCENARIO,
    CoachContext,
    save_context,
    resolve_context,
)


# 1. 前端调用逻辑， 不用明显接触数据， 不直接在后端sdk调用方式修改， 
# 直接通过interrput，给新的用户选择， 后端自己处理store的存储，然后新的下一次自己取读取新的store
# （sdk也有方式直接修改store，但是不推荐）

def is_new_dialog_route(state: SubgraphState) -> Literal["new_dialog", "continue_dialog"]:
    if state.get("new_dialog", True): # 第一次是None，默认初始化
        return "new_dialog"
    else:
        return "continue_dialog"

# 将入参数据/store数据，存储到state，其他节点都使用state
def continue_dialog_node(state: SubgraphState, runtime: Runtime[CoachContext]) -> SubgraphState:
    raw_text = state.get("raw_text")


    # messages = state.get("messages")  # todo 检查是默认带 接着上下文，checkpointer
    role = state.get("role", DEFAULT_ROLE)
    scenario = state.get("scenario", DEFAULT_SCENARIO)

    model = get_coach_model(role, scenario)
    # 链入参是 dict：MessagesPlaceholder 变量名 -> 消息列表；不能传裸列表
    res = model.invoke({"messages": [HumanMessage(raw_text)]})
    return {
        "logger": [f"continue_dialog_node执行完毕raw_text={raw_text}"],
        "messages": [res]
    }


def new_dialog_node(state: SubgraphState, runtime: Runtime[CoachContext]) -> SubgraphState:
    role = state.get("role", DEFAULT_ROLE)
    scenario = state.get("scenario", DEFAULT_SCENARIO)

    model = get_coach_model(role, scenario)
    res = model.invoke({"messages": [HumanMessage(NEW_DIALOG_START)]})
    return {
        "logger": [f"new_dialog_node执行完毕（role={role}, scenario={scenario}"],
        "messages": [res],
        "new_dialog": False,
    }

def test_add_logger_node(state: SubgraphState) -> SubgraphState:
    return {
        "logger": ["测试追加logger"]
    }


#1.4 构建子图
builder = StateGraph(state_schema=SubgraphState, context_schema=CoachContext)
builder.add_node("continue_dialog_node", continue_dialog_node)
builder.add_node("new_dialog_node", new_dialog_node)
builder.add_node("test_add_logger_node", test_add_logger_node)


# 必须用导入的 START 常量（值为 "__start__"），写字符串 "START" 会报 unknown node
builder.add_conditional_edges(START, is_new_dialog_route, path_map={
    "new_dialog": "new_dialog_node",
    "continue_dialog": "continue_dialog_node",
})

builder.add_edge("continue_dialog_node", "test_add_logger_node")
builder.add_edge("new_dialog_node", "test_add_logger_node")
builder.add_edge("test_add_logger_node", END)


coach_reply_subgraph = builder.compile()
