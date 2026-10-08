from langgraph.graph import StateGraph,START,END

from src.talk_agent.state import SubgraphState
from src.tools.audio_tool.xfyun_ita.xfyun_iat_tool import xfyun_iat_tool


#1.2 声明子图的节点
def coach_reply_node(state:SubgraphState) -> SubgraphState:
    return {
        "logger": ["coach_reply_node执行完毕"]
    }


#1.4 构建子图
builder = StateGraph(state_schema=SubgraphState)
builder.add_node("coach_reply_node",coach_reply_node)
builder.add_edge(START,"coach_reply_node")
builder.add_edge("coach_reply_node",END)
coach_reply_subgraph = builder.compile()
