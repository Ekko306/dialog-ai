from langgraph.graph import StateGraph,START,END

from src.talk_agent.state import SubgraphState


#1.2 声明子图的节点
def polisher_node(state:SubgraphState) -> SubgraphState:
    return {
        "logger": ["polisher_node执行完毕"]
    }


#1.4 构建子图
builder = StateGraph(state_schema=SubgraphState)
builder.add_node("polisher_node",polisher_node)
builder.add_edge(START,"polisher_node")
builder.add_edge("polisher_node",END)
polisher_subgraph = builder.compile()
