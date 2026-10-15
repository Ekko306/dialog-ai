import sys
from pathlib import Path

# 兼容直接运行本文件（python graph.py）：把 backend 目录加入 sys.path，
# 使 src.* 绝对导入可用；langgraph dev / uv run 下 backend 本就在 sys.path，无副作用
_BACKEND_DIR = Path(__file__).resolve().parents[2]  # backend/src/talk_agent/graph.py -> backend
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from langgraph.graph import StateGraph,START,END  # noqa: E402

from src.talk_agent.state import OverAllState  # noqa: E402
from src.talk_agent.subgraphs.grammar_check_subgraph import grammar_check_subgraph  # noqa: E402

from src.talk_agent.subgraphs.grammer_tutor_subgraph import grammer_tutor_subgraph  # noqa: E402
from src.talk_agent.subgraphs.polisher_subgraph import polisher_subgraph  # noqa: E402

from src.talk_agent.subgraphs.coach_reply_subgraph import coach_reply_subgraph  # noqa: E402
from typing import Literal  # noqa: E402
from src.tools.audio_tool.xfyun_ita.xfyun_iat_tool import xfyun_iat_tool_by_mic
from langgraph.types import interrupt  # noqa: E402
from src.tools.text_tool.scene_tool import new_scene_tool


def tts_tool_node(state:OverAllState) -> OverAllState:
    pass


def HITL_node(state: OverAllState) -> OverAllState:
    user_input = interrupt({"prompt": "请输入指令（输入 'context切换' 进入下一个教练场景）"})
    return {
        "user_input": user_input
    }


def HITL_route(state: OverAllState) -> Literal["new_context", "ita_audio"]:
    user_input = state.get("user_input", "")
    if "_new_context_" in user_input:
        return "new_context"
    else:
        return "ita_audio"

# new_context分支
def new_context_node(state:OverAllState) -> OverAllState:
    user_input = state.get("user_input", "")
    # 1. 调用工具获取新场景
    new_scene = new_scene_tool(user_input)
    # 2. 保存到store
    pass



# ita_audio分支
def xfyun_ita_tool_node(state:OverAllState) -> OverAllState:
    text, _audio = xfyun_iat_tool_by_mic()  # audio 为录音 PCM 字节，暂不放入 state
    return {
        "raw_text": text
    }

# 定义自定义路由
def has_issue_route(state: OverAllState) -> Literal["has_issue", "has_no_issue"]:
    if state.get("has_issue", False):
        return "has_issue"
    else:
        return "has_no_issue"


# 定义节点
parent_builder = StateGraph(state_schema=OverAllState)
parent_builder.add_node("coach_reply_subgraph",coach_reply_subgraph)
parent_builder.add_node("tts_tool_node", new_context_node)
parent_builder.add_node("HITL_node", HITL_node)
parent_builder.add_node("new_context_node", new_context_node)
parent_builder.add_node("xfyun_ita_tool_node", xfyun_ita_tool_node)
parent_builder.add_node("grammar_check_subgraph",grammar_check_subgraph)
parent_builder.add_node("grammer_tutor_subgraph",grammer_tutor_subgraph)
parent_builder.add_node("polisher_subgraph",polisher_subgraph)


# 定义边
parent_builder.add_edge(START,"coach_reply_subgraph")
parent_builder.add_edge("coach_reply_subgraph","tts_tool_node")
parent_builder.add_edge("tts_tool_node","HITL_node")
parent_builder.add_conditional_edges("HITL_node", HITL_route, path_map={
    "new_context": "new_context_node",
    "ita_audio": "xfyun_ita_tool_node",
})

# new_context分支
parent_builder.add_edge("new_context_node",END)



# ita_audio分支
parent_builder.add_edge("xfyun_ita_tool_node","grammar_check_subgraph")
parent_builder.add_conditional_edges("grammar_check_subgraph", has_issue_route, path_map={
    "has_issue": "grammer_tutor_subgraph",
    "has_no_issue": "polisher_subgraph",
})
# has_issue分支
parent_builder.add_edge("grammer_tutor_subgraph", "coach_reply_subgraph")
# has_no_issue分支
parent_builder.add_edge("polisher_subgraph", "coach_reply_subgraph")
parent_builder.add_edge("coach_reply_subgraph",END)

# 构建图
graph = parent_builder.compile()

if __name__ == "__main__":
    # res = graph.invoke({"raw_text": "error"})
    res = graph.invoke({})
    print(res)