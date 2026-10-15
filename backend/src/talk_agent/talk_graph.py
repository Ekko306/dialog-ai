import sys
from pathlib import Path

# 兼容直接运行本文件（python graph.py）：把 backend 目录加入 sys.path，
# 使 src.* 绝对导入可用；langgraph dev / uv run 下 backend 本就在 sys.path，无副作用
_BACKEND_DIR = Path(__file__).resolve().parents[2]  # backend/src/talk_agent/graph.py -> backend
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from langgraph.graph import StateGraph,START,END  # noqa: E402

from src.talk_agent.state import OverAllState, SubgraphState  # noqa: E402
from src.talk_agent.subgraphs.grammar_check_subgraph import grammar_check_subgraph  # noqa: E402

from src.talk_agent.subgraphs.grammer_tutor_subgraph import grammer_tutor_subgraph  # noqa: E402
from src.talk_agent.subgraphs.polisher_subgraph import polisher_subgraph  # noqa: E402

from src.talk_agent.subgraphs.coach_reply_subgraph import coach_reply_subgraph  # noqa: E402
from typing import Literal  # noqa: E402
from src.tools.audio_tool.xfyun_ita.xfyun_iat_tool import xfyun_iat_tool_by_mic
from langgraph.types import interrupt  # noqa: E402
from src.tools.text_tool.scene_tool import new_scene_tool

from src.talk_agent.coach_context import (  # noqa: E402
    DEFAULT_ROLE,
    DEFAULT_SCENARIO,
    CoachContext,
    save_context,
    resolve_context,
)

from langgraph.runtime import Runtime  # noqa: E402
from langgraph.checkpoint.memory import InMemorySaver

def store_resolve_node(state: OverAllState, runtime: Runtime[CoachContext]) -> OverAllState:
    # 挂在父图的节点入参必须注解为 OverAllState：
    # 若注解 SubgraphState，add_node 会把其 add-reducer 的 logger channel 注册进父图，
    # 与父图 LastValue 的 logger 类型冲突（Channel 'logger' already exists with a different type）
    role, scenario, source = resolve_context(runtime.context, runtime.store)
    return {
        "role": role,
        "scenario": scenario,
        # 父图 logger 是 LastValue：整体覆盖语义，须带上已有列表追加，否则会清空历史日志
        "logger": [*state.get("logger", []), f"store_resolve_node执行完毕（role={role}, scenario={scenario}, 来源:{source}）"],
    }


def HITL_node(state: OverAllState) -> OverAllState:
    user_input = interrupt({"prompt": "请输入指令（输入 '_new_context_' 进入下一个教练场景， '_test_coach_'跳过纠错，直接coach对话）"})
    return {
        "user_input": user_input
    }


def HITL_route(state: OverAllState) -> Literal["new_context", "ita_audio", "__end__"]:
    user_input = state.get("user_input", "")
    if "_new_context_" in user_input:
        return "new_context"
    if "_test_coach_" in user_input:
        return "__end__"
    else:
        return "ita_audio"


# new_context分支
def new_context_node(state: OverAllState, runtime: Runtime[CoachContext]) -> SubgraphState:
    user_input = state.get("user_input", "")  # todo 根据用户输入切换场景， 三种
    # 直接读入口节点 hydrate 进 state 的 context 快照（子图 coach_reply_node 已解析过）
    old_role = state.get("role", DEFAULT_ROLE)
    old_scenario = state.get("scenario", DEFAULT_SCENARIO)
    next_context: CoachContext = new_scene_tool(old_role, old_scenario)


    # 2. 保存到store
    save_context(
        runtime.store,
        next_context.role or DEFAULT_ROLE,
        next_context.scenario or DEFAULT_SCENARIO
        )
    return {
        "logger": [f"new_context_node: {old_role}/{old_scenario} → {next_context.role}/{next_context.scenario}（下次对话生效）"],
        "role": next_context.role or DEFAULT_ROLE,
        "scenario": next_context.scenario or DEFAULT_SCENARIO,
        "new_dialog": True
    }

# ita_audio分支
def ita_tool_node(state:OverAllState) -> OverAllState:
    text, _audio = xfyun_iat_tool_by_mic()  # audio 为录音 PCM 字节，暂不放入 state
    return {
        "raw_text": text,
        "audio": _audio  # todo优化成落盘，现在每次很大数据一直携带
    }

# 定义自定义路由
def has_issue_route(state: OverAllState) -> Literal["has_issue", "has_no_issue"]:
    if state.get("has_issue", False):
        return "has_issue"
    else:
        return "has_no_issue"


# 定义节点
parent_builder = StateGraph(state_schema=OverAllState, context_schema=CoachContext)
parent_builder.add_node("store_resolve_node", store_resolve_node)  # store数据转state
parent_builder.add_node("coach_reply_subgraph",coach_reply_subgraph)
parent_builder.add_node("new_context_node", new_context_node) # 更新state数据到store
parent_builder.add_node("HITL_node", HITL_node)
parent_builder.add_node("ita_tool_node", ita_tool_node)
parent_builder.add_node("grammar_check_subgraph",grammar_check_subgraph)
parent_builder.add_node("grammer_tutor_subgraph",grammer_tutor_subgraph)
parent_builder.add_node("polisher_subgraph",polisher_subgraph)


# 定义边
parent_builder.add_edge(START,"store_resolve_node")
parent_builder.add_edge("store_resolve_node","coach_reply_subgraph")
parent_builder.add_edge("coach_reply_subgraph","HITL_node")
parent_builder.add_conditional_edges("HITL_node", HITL_route, path_map={
    "new_context": "new_context_node",
    "ita_audio": "ita_tool_node",
    "__end__": END,  # 路由返回的每个值都必须在 path_map 里，END 分支也要登记
})

# new_context分支
parent_builder.add_edge("new_context_node",END)



# ita_audio分支
parent_builder.add_edge("ita_tool_node","grammar_check_subgraph")
parent_builder.add_conditional_edges("grammar_check_subgraph", has_issue_route, path_map={
    "has_issue": "grammer_tutor_subgraph",
    "has_no_issue": "polisher_subgraph",
})
# has_issue分支
parent_builder.add_edge("grammer_tutor_subgraph", END)
# has_no_issue分支
parent_builder.add_edge("polisher_subgraph", END)

# 构建图
# langgraph dev / LangGraph 平台会自动注入持久化 checkpointer，
# 模块级 compile 不能自带 checkpointer（否则启动报 GraphLoadError 拒绝加载）。
# 本地直接运行本文件调 interrupt 流程时，才需要手动挂 InMemorySaver（走 __main__ 分支）
if __name__ == "__main__":
    graph = parent_builder.compile(checkpointer=InMemorySaver())
else:
    graph = parent_builder.compile()