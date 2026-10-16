# user_input： 1. 新场景 2. 换话题 3. 选场景

from src.talk_agent.coach_context import CoachContext

DEFAULT_ROLE = "英语口语教练"
DEFAULT_SCENARIO = "日常闲聊"


# context 轮换数组：human-in-the-loop 触发"切换下一个"时按此顺序循环
CONTEXT_SEQUENCE = [
    CoachContext(role="英语口语教练", scenario="日常闲聊"),
    CoachContext(role="雅思口语考官", scenario="Part 1 面试"),
    CoachContext(role="雅思口语考官", scenario="Part 2 话题陈述"),
    CoachContext(role="商务英语教练", scenario="职场会议"),
]
i = 0


def new_scene_tool(role: str, scenario: str) -> CoachContext:
    idx = next(
        (i for i, c in enumerate(CONTEXT_SEQUENCE) if c.role == role and c.scenario == scenario),
        -1,
    )
    return CONTEXT_SEQUENCE[(idx + 1) % len(CONTEXT_SEQUENCE)] if idx >= 0 else CONTEXT_SEQUENCE[0]
