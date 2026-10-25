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
    # _new_context_/_test_coach_/_set_context_ 是内部指令（与 HITL_route 同一判定约定），不入对话记录。
    # _set_context_：前端场景弹窗的"指定场景"指令（_set_context_::<role>::<scenario>），002 契约
    update: OverAllState = {"user_input": user_input}
    if (
        "_new_context_" not in user_input
        and "_test_coach_" not in user_input
        and "_set_context_" not in user_input
    ):
        update["messages"] = [HumanMessage(content=user_input)]
    return update


def audio_choice_node(state: OverAllState) -> OverAllState:
    """进入润色子图前的 HITL：让用户决定是否生成语音。"""
    choice = interrupt({
        "prompt": "是否将润色结果合成为语音？(yes/no)",
        "options": ["yes", "no"],
    })
    enable = str(choice).strip().lower() in {"yes", "y", "true", "1"}
    return {
        "enable_tts": enable,
        "logger": [*state.get("logger", []), f"audio_choice_node: 用户选择 enable_tts={enable}"],
    }


def HITL_route(state: OverAllState) -> Literal["set_context", "new_context", "audio_check", "__end__"]:
    user_input = state.get("user_input", "")
    # _set_context_（弹窗指定场景）优先判定：命令串含 "::" 段，需在 audio_check 前分流
    if "_set_context_" in user_input:
        return "set_context"
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

# set_context分支：前端场景弹窗指定场景（002 契约 contracts/scene-apply-command.md §3.3）。
# 解析 _set_context_::<role>::<scenario> → 复用既有 save_context 落 Store；
# 与 _new_context_（轮换下一个）并存，后写者生效。不调 LLM、不写 messages。
# 自定义入口扩展：role/scenario 接受任意字符串（含前端自定义表单），仅做
# 截断防御（24 字符，与前端 sanitizeSceneInput 对齐）；段缺失/空白回退默认值，不抛错
def set_context_node(state: OverAllState, runtime: Runtime[CoachContext]) -> OverAllState:
    user_input = state.get("user_input", "")
    parts = user_input.split("::")
    role = parts[1].strip()[:24] if len(parts) > 1 and parts[1].strip() else DEFAULT_ROLE
    scenario = parts[2].strip()[:24] if len(parts) > 2 and parts[2].strip() else DEFAULT_SCENARIO
    save_context(runtime.store, role, scenario)
    return {
        "role": role,
        "scenario": scenario,
        # 关键：显式置回 True。首轮 new_dialog_node 会把该 key 写成 False，
        # 若不重置，续跑 coach 子图会误入 continue_dialog_node（其 raw_text 为 None
        # → HumanMessage(None) 崩溃 → run 异常 → 教练无回复）。
        # True = 切换场景后出全新话题，与 new_context_node 契约一致
        "new_dialog": True,
        "logger": [*state.get("logger", []), f"set_context_node: 场景切换为 {role}/{scenario}（立即生效）"],
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
    polisher = state.get("polisher") or {}
    original_text = (polisher.get("original_text") or "").strip()
    polished_text = (polisher.get("polished_text") or "").strip()
    explanation = (polisher.get("explanation") or "").strip()

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
parent_builder.add_node("set_context_node", set_context_node) # 弹窗指定场景落store（002）
parent_builder.add_node("HITL_node", HITL_node)
parent_builder.add_node("grammar_check_subgraph",grammar_check_subgraph)
parent_builder.add_node("grammar_check_fallback_node",grammar_check_fallback_node)
parent_builder.add_node("grammer_tutor_subgraph",grammer_tutor_subgraph)
parent_builder.add_node("audio_choice_node", audio_choice_node)
parent_builder.add_node("tutor_reply_message_node",tutor_reply_message_node)
parent_builder.add_node("polisher_subgraph",polisher_subgraph)
parent_builder.add_node("polisher_reply_message_node",polisher_reply_message_node)


# 定义边
parent_builder.add_edge(START,"store_resolve_node")
parent_builder.add_edge("store_resolve_node","coach_reply_subgraph")
parent_builder.add_edge("coach_reply_subgraph","HITL_node")
parent_builder.add_conditional_edges("HITL_node", HITL_route, path_map={
    "set_context": "set_context_node",
    "new_context": "new_context_node",
    "audio_check": "grammar_check_subgraph",
    "__end__": END,  # 路由返回的每个值都必须在 path_map 里，END 分支也要登记
})

# new_context分支
parent_builder.add_edge("new_context_node",END)

# set_context分支：落 Store 后不结束，同 run 内直接续跑 coach 子图——教练立即用新场景出下一话题。
# 原设计（END + 前端 AutoContinue 续跑）存在时序竞态，run 结束后教练无可见回复；
# 改为续跑后 run 停在下一轮 HITL，AutoContinue 看到未结束不会插手。
# coach_reply_subgraph 入口按 new_dialog 路由：缺省走 new_dialog_node 全新话题（set_context 不写该 key，恰好命中）
parent_builder.add_edge("set_context_node","coach_reply_subgraph")



# audio_check分支：ita_tool_node 是 grammar_check_subgraph 的入口节点，
# 上方 HITL_route 的 "audio_check" → "grammar_check_subgraph" 即进入 语音转写→语法检查 链路
parent_builder.add_conditional_edges("grammar_check_subgraph", has_issue_route, path_map={
    "has_issue": "grammer_tutor_subgraph",
    "has_no_issue": "audio_choice_node",
    "check_failed": "grammar_check_fallback_node",
})
# has_issue分支：tutor 输出先落成对话消息（tutor_reply → AI 消息），再结束
parent_builder.add_edge("grammer_tutor_subgraph", "tutor_reply_message_node")
parent_builder.add_edge("tutor_reply_message_node", END)
# has_no_issue分支：先弹 HITL 询问是否生成语音，再进润色子图，结果落成反馈消息
parent_builder.add_edge("audio_choice_node", "polisher_subgraph")
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