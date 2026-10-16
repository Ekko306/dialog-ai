import sys
from pathlib import Path

# 兼容直接运行本文件：把 backend 目录加入 sys.path，使 src.* 绝对导入可用；
# langgraph dev / uv run 下 backend 本就在 sys.path，无副作用
_BACKEND_DIR = Path(__file__).resolve().parents[3]  # subgraphs 比 graph.py 深一层
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from langgraph.graph import StateGraph,START,END  # noqa: E402

from src.talk_agent.state import SubgraphState  # noqa: E402
from src.tools.audio_tool.xfyun_ita.xfyun_iat_tool import xfyun_iat_tool_by_mic


# 输入音频
# 1. 测试通过文件
# 2. 开发环境通过主节点传递音频变量
# ita_audio分支
def ita_tool_node(state:SubgraphState) -> SubgraphState:
    text, _audio = xfyun_iat_tool_by_mic()  # audio 为录音 PCM 字节，暂不放入 state
    return {
        "raw_text": text,
        "audio": _audio  # todo优化成落盘，现在每次很大数据一直携带
    }


# 1. 先调用ise
# 2. 再调用llm+prompt评判
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
builder.add_node("ita_tool_node",ita_tool_node)
builder.add_node("grammar_check_node",grammar_check_node)

builder.add_edge(START,"ita_tool_node")
builder.add_edge("ita_tool_node","grammar_check_node")
builder.add_edge("grammar_check_node",END)

grammar_check_subgraph = builder.compile()

if __name__ == "__main__":
    # res = graph.invoke({"raw_text": "error"})
    res = grammar_check_subgraph.invoke({})
    print(res)