"""coach 子图的 context 逻辑封装。

本模块集中管理口语教练子图的上下文（角色/场景）：
- schema 定义（CoachContext）
- Store 持久化读写（跨对话记住 context）
- 三级优先级合并（显式 context > Store 上次值 > 默认值）
- 场景轮换数组（human-in-the-loop "切换下一个"）

子图文件只负责图流程编排，不关心 context 细节。
"""

from dataclasses import dataclass

from langgraph.store.base import BaseStore


#1.1 上下文 schema：字段为 None 表示"本次未指定"，节点将沿用 Store 里上次的值。
# Studio 的 Assistant Default Configuration / 主图 / curl 传值时字段非 None，视为本次显式覆盖


DEFAULT_ROLE = "英语口语教练"
DEFAULT_SCENARIO = "日常闲聊"

@dataclass
class CoachContext:
    role: str | None = None
    scenario: str | None = None




# Store 命名空间：生产可改为 ("coach_context", user_id) 做用户级隔离
_CONTEXT_NS = ("coach_context",)
_CONTEXT_KEY = "current"


#1.2 Store 读写（跨对话记住 context 的持久化后盾）
def _load_stored(store: BaseStore | None, field: str) -> str | None:
    if store is None:  # 直接脚本运行等无 Store 场景，跳过持久化
        return None
    item = store.get(_CONTEXT_NS, _CONTEXT_KEY)
    if item is None:
        return None
    return item.value.get(field)


def save_context(store: BaseStore | None, role: str, scenario: str) -> None:
    """把本次生效的 context 落库 → 下次对话即新 context"""
    if store is None:
        return
    store.put(_CONTEXT_NS, _CONTEXT_KEY, {"role": role, "scenario": scenario})


#1.3 三级优先级合并：本次显式 context > Store 上次值 > 默认值
def resolve_context(
    context: CoachContext | None, store: BaseStore | None
) -> tuple[str, str, str]:
    """返回 (生效role, 生效scenario, 来源说明)"""
    ctx = context or CoachContext()
    stored_role = _load_stored(store, "role")
    stored_scenario = _load_stored(store, "scenario")

    if ctx.role is not None:
        role, role_src = ctx.role, "context覆盖"
    elif stored_role is not None:
        role, role_src = stored_role, "store沿用"
    else:
        role, role_src = DEFAULT_ROLE, "默认值"

    if ctx.scenario is not None:
        scenario, scenario_src = ctx.scenario, "context覆盖"
    elif stored_scenario is not None:
        scenario, scenario_src = stored_scenario, "store沿用"
    else:
        scenario, scenario_src = DEFAULT_SCENARIO, "默认值"

    return role, scenario, f"role:{role_src}/scenario:{scenario_src}"
