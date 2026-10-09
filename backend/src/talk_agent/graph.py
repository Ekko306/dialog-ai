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


def xfyun_ita_tool_node(state:OverAllState) -> OverAllState:
    text, _audio = xfyun_iat_tool_by_mic()  # audio 为录音 PCM 字节，暂不放入 state
    return {
        "raw_text": text
    }


# 定义节点
parent_builder = StateGraph(state_schema=OverAllState)
parent_builder.add_node("xfyun_ita_tool_node", xfyun_ita_tool_node)
parent_builder.add_node("grammar_check_subgraph",grammar_check_subgraph)
parent_builder.add_node("grammer_tutor_subgraph",grammer_tutor_subgraph)
parent_builder.add_node("polisher_subgraph",polisher_subgraph)
parent_builder.add_node("coach_reply_subgraph",coach_reply_subgraph)

# 定义自定义路由
def my_route(state: OverAllState) -> Literal["has_issue", "has_no_issue"]:
    if state.get("has_issue", False):
        return "has_issue"
    else:
        return "has_no_issue"

# 定义边
parent_builder.add_edge(START,"xfyun_ita_tool_node")
parent_builder.add_edge("xfyun_ita_tool_node","grammar_check_subgraph")
parent_builder.add_conditional_edges("grammar_check_subgraph", my_route, path_map={
    "has_issue": "grammer_tutor_subgraph",
    "has_no_issue": "polisher_subgraph",
})
parent_builder.add_edge("grammer_tutor_subgraph", "coach_reply_subgraph")
parent_builder.add_edge("polisher_subgraph", "coach_reply_subgraph")
parent_builder.add_edge("coach_reply_subgraph",END)

# 构建图
graph = parent_builder.compile()

if __name__ == "__main__":
    # res = graph.invoke({"raw_text": "error"})
    res = graph.invoke({})
    print(res)