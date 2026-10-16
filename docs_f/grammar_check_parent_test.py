# grammar_check 父图路由测试床（阶段4）
# 验证 my_route 三分支：has_issue / has_no_issue / check_failed
# 说明：tutor / polisher / fallback 在这里都是占位节点，
#       只用来验证路由走向，不代表真实业务实现。
# 运行：python docs_f/grammar_check_parent_test.py
# 降级演练：$env:DEEPSEEK_API_KEY=''; python docs_f/grammar_check_parent_test.py
#          （load_dotenv 不覆盖已存在的环境变量 → 模拟 LLM 不可用 → check_failed）

from typing import Annotated, Literal, TypedDict

from langgraph.graph import StateGraph, START, END

# 复用练习文件里编译好的子图
from grammar_check_test import grammar_check_subgraph


# ========== 父图 State ==========


class ParentState(TypedDict, total=False):
    # 与子图对齐的字段（子图输出按这些 key 合并进父图）
    raw_text: str
    has_issue: bool
    issues: list[str]
    feedback: str
    corrected_text: str
    grammar_check_status: str

    # 父图日志：LastValue——子图输出的累积列表被父图整体接管（对照 state.py 的设计）
    grammar_check_logs: list[str]

    # 下游业务字段（本测试床用占位节点填充）
    final_reply: str


# ========== 条件路由：本模块的核心交付 ==========


def my_route(state: ParentState) -> Literal["has_issue", "has_no_issue", "check_failed"]:
    # 检查失败（empty_input / invalid_input / unavailable）或 has_issue 缺失
    # → 一律 check_failed，绝不能当成"没有语法问题"
    if state.get("grammar_check_status") != "ok" or state.get("has_issue") is None:
        return "check_failed"

    return "has_issue" if state.get("has_issue") else "has_no_issue"


# ========== 占位节点（验证路由走向用） ==========


def grammer_tutor_node(state: ParentState) -> ParentState:
    issues = state.get("issues", [])
    return {
        "final_reply": f"[语法纠错占位] 发现{len(issues)}处错误，将进入纠错子图",
        "grammar_check_logs": ["grammer_tutor_node：占位执行"],
    }


def polisher_node(state: ParentState) -> ParentState:
    return {
        "final_reply": "[润色占位] 未发现语法错误，将进入表达润色子图",
        "grammar_check_logs": ["polisher_node：占位执行"],
    }


def grammar_check_fallback_node(state: ParentState) -> ParentState:
    status = state.get("grammar_check_status", "unknown")
    return {
        "final_reply": f"[兜底占位] 语法检查未完成({status})，请稍后再试",
        "grammar_check_logs": [f"grammar_check_fallback_node：status={status}"],
    }


# ========== 构建父图 ==========

parent_builder = StateGraph(state_schema=ParentState)
parent_builder.add_node("grammar_check_subgraph", grammar_check_subgraph)
parent_builder.add_node("grammer_tutor_node", grammer_tutor_node)
parent_builder.add_node("polisher_node", polisher_node)
parent_builder.add_node("grammar_check_fallback_node", grammar_check_fallback_node)

parent_builder.add_edge(START, "grammar_check_subgraph")
parent_builder.add_conditional_edges(
    "grammar_check_subgraph",
    my_route,
    path_map={
        "has_issue": "grammer_tutor_node",
        "has_no_issue": "polisher_node",
        "check_failed": "grammar_check_fallback_node",
    },
)
parent_builder.add_edge("grammer_tutor_node", END)
parent_builder.add_edge("polisher_node", END)
parent_builder.add_edge("grammar_check_fallback_node", END)

parent_graph = parent_builder.compile()


if __name__ == "__main__":
    for text in ["She go to school every day.", "I agree with you.", ""]:
        res = parent_graph.invoke({"raw_text": text})
        print(f"输入: {text!r}")
        print(f"  status={res.get('grammar_check_status')} → {res.get('final_reply')}")
