
"""英语口语表达润色 LangGraph 子图。"""

from langgraph.graph import StateGraph, START, END

from src.talk_agent.state import SubgraphState
from src.talk_agent.subgraphs.polisher_subgraph.polisher_nodes import (
    polisher_node,
    tts_node,
)


# 1. 创建状态图
builder = StateGraph(SubgraphState)

# 2. 注册节点
builder.add_node("polisher_node", polisher_node)
builder.add_node("tts_node", tts_node)

# 3. 定义执行流程
builder.add_edge(START, "polisher_node")
builder.add_edge("polisher_node", "tts_node")
builder.add_edge("tts_node", END)

# 4. 编译子图
polisher_subgraph = builder.compile()
