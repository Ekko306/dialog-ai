from langgraph.graph import StateGraph,START,END

from src.talk_agent.state import SubgraphState


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
