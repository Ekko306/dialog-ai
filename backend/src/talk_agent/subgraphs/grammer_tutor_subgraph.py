from langgraph.graph import StateGraph,START,END

from src.talk_agent.state import SubgraphState


#1.2 声明子图的节点
def grammar_tutor_node(state:SubgraphState) -> SubgraphState:
    return {
        "logger": ["grammar_tutor_node执行完毕"]
    }

#1.4 构建子图
builder = StateGraph(state_schema=SubgraphState)
builder.add_node("grammar_tutor_node",grammar_tutor_node)

builder.add_edge(START,"grammar_tutor_node")
builder.add_edge("grammar_tutor_node",END)

grammer_tutor_subgraph = builder.compile()
