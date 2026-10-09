import sys
from pathlib import Path

# 兼容直接运行本文件：把 backend 目录加入 sys.path，使 src.* 绝对导入可用；
# langgraph dev / uv run 下 backend 本就在 sys.path，无副作用
_BACKEND_DIR = Path(__file__).resolve().parents[3]  # subgraphs 比 graph.py 深一层
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from langgraph.graph import StateGraph,START,END  # noqa: E402

from src.talk_agent.state import SubgraphState  # noqa: E402


#1.2 声明子图的节点
def grammar_check_node(state:SubgraphState) -> SubgraphState:
    raw_text = state.get("raw_text", "")
    new_state: SubgraphState = {
        "logger": ["grammar_check_node执行完毕"]
    }
    if ("天气" in raw_text):
        new_state["has_issue"] = True
    else:
        new_state["has_issue"] = False
    return new_state


#1.4 构建子图
builder = StateGraph(state_schema=SubgraphState)
builder.add_node("grammar_check_node",grammar_check_node)

builder.add_edge(START,"grammar_check_node")
builder.add_edge("grammar_check_node",END)

grammar_check_subgraph = builder.compile()

if __name__ == "__main__":
    # res = graph.invoke({"raw_text": "error"})
    res = grammar_check_subgraph.invoke({})
    print(res)