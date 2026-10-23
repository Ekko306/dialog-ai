import sys
from pathlib import Path

# 兼容直接运行本文件（python graph.py）：把 backend 目录加入 sys.path，
# 使 src.* 绝对导入可用；langgraph dev / uv run 下 backend 本就在 sys.path，无副作用
_BACKEND_DIR = Path(__file__).resolve().parents[2]  # backend/src/talk_agent/graph.py -> backend
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from langgraph.graph import StateGraph,START,END  # noqa: E402

from src.talk_agent.state import OverAllState, SubgraphState  # noqa: E402
from src.talk_agent.subgraphs.grammar_check_subgraph.grammar_check_subgraph import grammar_check_subgraph  # noqa: E402

from src.talk_agent.subgraphs.grammar_tutor_subgraph.grammar_tutor_subgraph import grammer_tutor_subgraph  # noqa: E402
from src.talk_agent.subgraphs.polisher_subgraph.polisher_subgraph import polisher_subgraph  # noqa: E402

from src.talk_agent.subgraphs.coach_reply_subgraph.coach_reply_subgraph import coach_reply_subgraph  # noqa: E402
from typing import Literal  # noqa: E402
from langgraph.types import interrupt  # noqa: E402
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage  # noqa: E402
from src.tools.text_tool.scene_tool import new_scene_tool

from src.talk_agent.context.coach_context import (  # noqa: E402
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
    print(f"user_input:{user_input}")
    # LangGraph 官方 HITL 范式：resume 值作为用户回合写入 messages。
    # 前端 useStreamRuntime 以图状态 messages 为唯一渲染源，
    # 不写入则用户输入永远不出现在对话流里，轮次之间也就没有分隔边界。
    # _new_context_/_test_coach_ 是内部指令（与 HITL_route 同一判定约定），不入对话记录。
    update: OverAllState = {"user_input": user_input}
    if "_new_context_" not in user_input and "_test_coach_" not in user_input:
        update["messages"] = [HumanMessage(content=user_input)]
    return update


def HITL_route(state: OverAllState) -> Literal["new_context", "audio_check", "__end__"]:
    user_input = state.get("user_input", "")
    if "_new_context_" in user_input:
        return "new_context"
    if "_test_coach_" in user_input:
        return "__end__"
    else:
        return "audio_check"


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
        "logger": [*state.get("logger", []), f"new_context_node: {old_role}/{old_scenario} → {next_context.role}/{next_context.scenario}（下次对话生效）"],
        "role": next_context.role or DEFAULT_ROLE,
        "scenario": next_context.scenario or DEFAULT_SCENARIO,
        "new_dialog": True
    }

# 定义自定义路由：三分支——检查成功按 has_issue 走纠错/润色；
# 检查未完成一律 check_failed，绝不能把"没检查成"当成"没有语法问题"
def has_issue_route(state: OverAllState) -> Literal["has_issue", "has_no_issue", "check_failed"]:
    if state.get("grammar_check_status") != "ok" or state.get("has_issue") is None:
        return "check_failed"

    return "has_issue" if state.get("has_issue") else "has_no_issue"

def grammar_check_fallback_node(state: OverAllState) -> OverAllState:
    """语法检查未完成（empty_input / invalid_input / unavailable）时的兜底节点。

    用户要求每轮输入（语音/文本一致）都必须有可见反馈：检查没完成绝不能静默，
    更不能当成"没有语法问题"，因此除记录原因外，补一条诚实的兜底 AI 消息告知用户。
    """
    status = state.get("grammar_check_status", "unknown")
    # grammar_check_logs 在父图是 LastValue（整表接管），父图节点追加日志需手动合并
    logs = list(state.get("grammar_check_logs", []))
    logs.append(f"grammar_check_fallback_node：语法检查未完成({status})，走兜底分支")
    # 兜底话术按状态给出诚实原因（不是"没有错误"，是"没检查成"）
    reason = {
        "empty_input": "没有识别到有效内容",
        "invalid_input": "输入内容无法用于语法检查",
        "unavailable": "语法检查服务暂时不可用",
    }.get(status, f"语法检查未完成（{status}）")
    return {
        "grammar_check_logs": logs,
        "messages": [
            AIMessage(content=f"{reason}，本次无法给出语法反馈，请稍后重试。"),
            SystemMessage(content=""),
        ],
    }


def tutor_reply_message_node(state: OverAllState) -> OverAllState:
    """把 grammer_tutor 输出的 tutor_reply 从 state 提升为对话消息（round 收尾）。

    - AIMessage(tutor_reply)：纠错讲解作为一条教练侧 AI 消息进入 messages，
      前端 useStreamRuntime 只渲染 messages，由此成为常驻的左侧对话消息
      （与 HITL_node 写 HumanMessage 同一官方范式，历史/checkpointer/刷新均保留）。
    - SystemMessage("")：空系统消息分隔符。assistant-ui 转换层会把相邻的
      assistant 消息合并成同一个气泡，tutor 讲解与下一轮 coach 话题相邻会被
      粘连；system 角色在消息块切分时强制断开，空内容渲染近乎零占位。
    """
    tutor_reply = state.get("tutor_reply") or ""
    if not tutor_reply.strip():
        return {}
    return {
        "messages": [
            AIMessage(content=tutor_reply),
            SystemMessage(content=""),
        ]
    }


def polisher_reply_message_node(state: OverAllState) -> OverAllState:
    """把 polisher 分支（语法正确）的反馈提升为对话消息（round 收尾）.

    - 用户要求每轮输入（语音/文本一致）都必须有可见反馈：has_issue=True 走
      tutor_reply_message_node，语法正确（has_no_issue）走本节点，两条路径
      都写 messages，不再静默。反馈文案按用户指定方向必含"当前语句没有错误"。
    - polisher 有实际润色产出（polished_text 非空且 ≠ original_text）时，
      附上润色建议与说明；无润色（或降级保留原文）时只给"没有错误"提示。
    - SystemMessage("")：空系统消息分隔符，理由同 tutor_reply_message_node——
      本反馈与下一轮 coach 话题 AIMessage 相邻会被 assistant-ui 合并成一个气泡。
    """
    original_text = (state.get("original_text") or "").strip()
    polished_text = (state.get("polished_text") or "").strip()
    explanation = (state.get("explanation") or "").strip()

    parts = ["当前语句没有错误，没有tutor_reply。"]
    if polished_text and polished_text != original_text:
        parts.append(f"润色建议：{polished_text}")
        if explanation:
            parts.append(explanation)
    return {
        "messages": [
            AIMessage(content="\n".join(parts)),
            SystemMessage(content=""),
        ]
    }


# 定义节点
parent_builder = StateGraph(state_schema=OverAllState, context_schema=CoachContext)
parent_builder.add_node("store_resolve_node", store_resolve_node)  # store数据转state
parent_builder.add_node("coach_reply_subgraph",coach_reply_subgraph)
parent_builder.add_node("new_context_node", new_context_node) # 更新state数据到store
parent_builder.add_node("HITL_node", HITL_node)
parent_builder.add_node("grammar_check_subgraph",grammar_check_subgraph)
parent_builder.add_node("grammar_check_fallback_node",grammar_check_fallback_node)
parent_builder.add_node("grammer_tutor_subgraph",grammer_tutor_subgraph)
parent_builder.add_node("tutor_reply_message_node",tutor_reply_message_node)
parent_builder.add_node("polisher_subgraph",polisher_subgraph)
parent_builder.add_node("polisher_reply_message_node",polisher_reply_message_node)


# 定义边
parent_builder.add_edge(START,"store_resolve_node")
parent_builder.add_edge("store_resolve_node","coach_reply_subgraph")
parent_builder.add_edge("coach_reply_subgraph","HITL_node")
parent_builder.add_conditional_edges("HITL_node", HITL_route, path_map={
    "new_context": "new_context_node",
    "audio_check": "grammar_check_subgraph",
    "__end__": END,  # 路由返回的每个值都必须在 path_map 里，END 分支也要登记
})

# new_context分支
parent_builder.add_edge("new_context_node",END)



# audio_check分支：ita_tool_node 是 grammar_check_subgraph 的入口节点，
# 上方 HITL_route 的 "audio_check" → "grammar_check_subgraph" 即进入 语音转写→语法检查 链路
parent_builder.add_conditional_edges("grammar_check_subgraph", has_issue_route, path_map={
    "has_issue": "grammer_tutor_subgraph",
    "has_no_issue": "polisher_subgraph",
    "check_failed": "grammar_check_fallback_node",
})
# has_issue分支：tutor 输出先落成对话消息（tutor_reply → AI 消息），再结束
parent_builder.add_edge("grammer_tutor_subgraph", "tutor_reply_message_node")
parent_builder.add_edge("tutor_reply_message_node", END)
# has_no_issue分支：语法正确也要有可见反馈（polisher 结果 → 反馈消息），再结束
parent_builder.add_edge("polisher_subgraph", "polisher_reply_message_node")
parent_builder.add_edge("polisher_reply_message_node", END)
# check_failed分支
parent_builder.add_edge("grammar_check_fallback_node", END)


# 构建图
# langgraph dev / LangGraph 平台会自动注入持久化 checkpointer，
# 模块级 compile 不能自带 checkpointer（否则启动报 GraphLoadError 拒绝加载）。
# 本地直接运行本文件调 interrupt 流程时，才需要手动挂 InMemorySaver（走 __main__ 分支）
if __name__ == "__main__":
    graph = parent_builder.compile(checkpointer=InMemorySaver())
else:
    graph = parent_builder.compile()