import sys
from pathlib import Path

# 兼容直接运行本文件：把 backend 目录加入 sys.path，使 src.* 绝对导入可用；
# langgraph dev / uv run 下 backend 本就在 sys.path，无副作用
_BACKEND_DIR = Path(__file__).resolve().parents[3]  # subgraphs 比 graph.py 深一层
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from langgraph.graph import StateGraph, START, END  # noqa: E402
from langgraph.runtime import Runtime  # noqa: E402
from langgraph.types import interrupt  # noqa: E402

from src.talk_agent.state import SubgraphState  # noqa: E402
from src.talk_agent.subgraphs.coach_context import (  # noqa: E402
    DEFAULT_SCENARIO,
    CoachContext,
    mock_next_context,
    resolve_context,
    save_context,
)


#1.1 主节点：每次对话必经 —— 解析本次生效的 context 并写回 Store（下次对话沿用）
def coach_reply_node(state: SubgraphState, runtime: Runtime[CoachContext]) -> SubgraphState:
    role, scenario, source = resolve_context(runtime.context, runtime.store)
    save_context(runtime.store, role, scenario)
    return {
        "logger": [f"coach_reply_node执行完毕（role={role}, scenario={scenario}, 来源:{source}）"]
    }


#1.2 Human-in-the-loop 节点：interrupt 暂停等待用户输入。
#    恢复时若文本含"context切换"，按轮换数组切换到下一个 context（写 Store）
def context_gate_node(state: SubgraphState, runtime: Runtime[CoachContext]) -> SubgraphState:
    # interrupt 第一次执行到此处图挂起；用户 resume 提供文本后，节点从头重跑并拿到该文本
    user_input = interrupt({"prompt": "请输入指令（输入 'context切换' 进入下一个教练场景）"})

    if "context切换" not in str(user_input or ""):
        return {"logger": ["context_gate_node: 未检测到切换指令，保持当前 context"]}

    role, scenario, _ = resolve_context(runtime.context, runtime.store)
    nxt = mock_next_context(role, scenario)
    save_context(runtime.store, nxt.role, nxt.scenario)
    return {
        "logger": [f"context_gate_node: {role}/{scenario} → {nxt.role}/{nxt.scenario}（下次对话生效）"]
    }


#1.3 例子节点：节点内主动修改 context —— 写 Store 后，下次对话就是新值
def update_scenario_node(state: SubgraphState, runtime: Runtime[CoachContext]) -> SubgraphState:
    """模拟：对话中检测到话题切换 → 按轮换数组更新 context。
    真实实现可把判定逻辑换成 LLM 结构化输出（如 Route 模式）。
    为不干扰 context_gate_node 的切换结果，仅当 scenario 仍是默认值时演示自动切换。
    """
    role, scenario, _ = resolve_context(runtime.context, runtime.store)
    nxt = mock_next_context(role, scenario)

    if nxt.scenario != scenario and scenario == DEFAULT_SCENARIO:
        save_context(runtime.store, nxt.role, nxt.scenario)
        return {"logger": [f"update_scenario_node: {role}/{scenario} → {nxt.role}/{nxt.scenario}（下次对话生效）"]}
    return {"logger": [f"update_scenario_node: scenario 无变化（仍为 {scenario}）"]}


#1.4 构建子图
builder = StateGraph(state_schema=SubgraphState, context_schema=CoachContext)
builder.add_node("coach_reply_node", coach_reply_node)
builder.add_node("context_gate_node", context_gate_node)
builder.add_node("update_scenario_node", update_scenario_node)


builder.add_edge(START, "coach_reply_node")
builder.add_edge("coach_reply_node", "context_gate_node")
builder.add_edge("context_gate_node", "update_scenario_node")
builder.add_edge("update_scenario_node", END)
coach_reply_subgraph = builder.compile()
