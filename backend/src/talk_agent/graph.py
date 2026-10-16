import sys
from pathlib import Path

# 兼容直接运行本文件（python graph.py）：把 backend 目录加入 sys.path，
# 使 src.* 绝对导入可用；langgraph dev / uv run 下 backend 本就在 sys.path，无副作用
_BACKEND_DIR = Path(__file__).resolve().parents[2]  # backend/src/talk_agent/graph.py -> backend
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from langgraph.graph import StateGraph,START,END  # noqa: E402

from src.talk_agent.state import OverAllState  # noqa: E402
from src.talk_agent.subgraphs.grammar_check_subgraph import grammar_check_subgraph  # noqa: E402

from src.talk_agent.subgraphs.grammer_tutor_subgraph import grammer_tutor_subgraph  # noqa: E402
from src.talk_agent.subgraphs.polisher_subgraph import polisher_subgraph  # noqa: E402

from src.talk_agent.subgraphs.coach_reply_subgraph import coach_reply_subgraph  # noqa: E402
from typing import Literal  # noqa: E402


def grammar_check_fallback_node(state: OverAllState) -> OverAllState:
    """语法检查未完成（empty_input / invalid_input / unavailable）时的兜底占位节点。

    占位实现：只记录失败原因，等团队后续决定兜底话术如何回给用户。
    """
    status = state.get("grammar_check_status", "unknown")
    # grammar_check_logs 在父图是 LastValue（整表接管），父图节点追加日志需手动合并
    logs = list(state.get("grammar_check_logs", []))
    logs.append(f"grammar_check_fallback_node：语法检查未完成({status})，走兜底分支")
    return {"grammar_check_logs": logs}


# 定义节点（语音链路 + 语法检查已整体移入 grammar_check_subgraph，
# 拍平后的执行顺序不变：ita → ise → ise_analyze → grammar_check → 路由）
parent_builder = StateGraph(state_schema=OverAllState)
parent_builder.add_node("grammar_check_subgraph",grammar_check_subgraph)
parent_builder.add_node("grammer_tutor_subgraph",grammer_tutor_subgraph)
parent_builder.add_node("polisher_subgraph",polisher_subgraph)
parent_builder.add_node("coach_reply_subgraph",coach_reply_subgraph)
parent_builder.add_node("grammar_check_fallback_node",grammar_check_fallback_node)


# 定义自定义路由：三分支——检查成功按 has_issue 走纠错/润色；
# 检查未完成一律 check_failed，绝不能把"没检查成"当成"没有语法问题"
def my_route(state: OverAllState) -> Literal["has_issue", "has_no_issue", "check_failed"]:
    if state.get("grammar_check_status") != "ok" or state.get("has_issue") is None:
        return "check_failed"

    return "has_issue" if state.get("has_issue") else "has_no_issue"

# 定义边
parent_builder.add_edge(START,"grammar_check_subgraph")
parent_builder.add_conditional_edges("grammar_check_subgraph", my_route, path_map={
    "has_issue": "grammer_tutor_subgraph",
    "has_no_issue": "polisher_subgraph",
    "check_failed": "grammar_check_fallback_node",
})
parent_builder.add_edge("grammer_tutor_subgraph", "coach_reply_subgraph")
parent_builder.add_edge("polisher_subgraph", "coach_reply_subgraph")
# 兜底分支同样汇入 coach_reply 统一产出本轮回复
# （coach 端实现时可依据 grammar_check_status 生成失败提示话术）
parent_builder.add_edge("grammar_check_fallback_node", "coach_reply_subgraph")
parent_builder.add_edge("coach_reply_subgraph",END)

# 构建图
graph = parent_builder.compile()

if __name__ == "__main__":
    # 运行结果不打印到终端：trace 自动上传 LangSmith（new-agent 项目），在网页端查看
    # 终端只保留语音交互提示（回车开始/结束录音）
    graph.invoke({})
    from langsmith import Client  # 局部导入：作为模块被导入时不引入 langsmith

    Client().flush()  # 等 trace 上传完成再退出，避免进程提前结束丢最后一条
    print("本轮运行结束，trace 已上传 → 浏览器打开 https://smith.langchain.com → Tracing → new-agent 查看")