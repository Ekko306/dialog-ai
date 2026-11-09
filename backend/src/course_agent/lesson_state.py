"""精品课时图的状态定义（LessonState）.

字段与 `frontend/specs/005-premium-course/data-model.md` 第 4 节一一对应。
仅描述受控的数据结构；图编排逻辑见 `lesson_graph.py`。
"""

from typing import Any, TypedDict


class ExerciseEvaluation(TypedDict, total=False):
    """单题评价结果（exercise 阶段 payload 的 result）。"""

    verdict: str  # correct / acceptable / incorrect
    feedback: str
    suggested: str


class RoleplayTurn(TypedDict, total=False):
    """角色扮演单轮记录。"""

    role: str  # assistant / user
    text: str
    evaluation: dict[str, Any] | None


class LessonSummary(TypedDict, total=False):
    """课时总结（summary 阶段 payload）。"""

    summary: str
    scores: dict[str, Any]
    suggestions: list[str]


class LessonState(TypedDict, total=False):
    """课时主图状态.

    `total=False`：节点按需写入，避免每个节点都要返回全量字段。
    """

    # --- 定位 ---
    user_id: str
    course_id: str
    chapter_id: str
    lesson_id: str
    lesson: dict[str, Any]
    course_name: str
    chapter_name: str

    # --- 流程 ---
    stage: str
    target_sentence: str
    user_input: str
    typed_ok: bool
    retry_count: int

    # --- 知识点主动提问 ---
    knowledge_prompt: dict[str, Any] | None
    knowledge_feedback: dict[str, Any] | None
    knowledge_attempts: int

    # --- 练习 ---
    exercise_index: int
    exercise_attempts: int
    exercise_result: dict[str, Any] | None
    exercise_verdict_passed: bool
    exercise_hint: str | None
    answered: dict[str, str]

    # --- 角色扮演 ---
    roleplay_round: int
    roleplay_messages: list[dict[str, Any]]
    roleplay_hint: str | None

    # --- 总结 / 落盘 ---
    evaluations: list[dict[str, Any]]
    summary: dict[str, Any] | None
    progress: dict[str, Any]
    error: str | None
    degraded: bool

    # --- 输出 ---
    done: bool
