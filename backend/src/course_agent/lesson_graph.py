"""精品课时 LangGraph（主图）.

流程（对应设计稿 ai-course-langgraph-design.md，MVP 裁剪版）：

    START → load_lesson_context
      ├─(按进度快进)→ present_scene / teach_knowledge / exercise_present ...
    present_scene → present_target_sentence → user_type_sentence(interrupt)
      → check_typed_sentence → 不通过且未满 2 次回 user_type_sentence；否则 → teach_knowledge
    teach_knowledge(interrupt) → exercise_present(interrupt) ⇄ exercise_evaluate
      → roleplay_present(interrupt) ⇄ roleplay_evaluate
      → summary_prepare → summary_present(interrupt) → update_progress → finalize_lesson → END

两条硬约束（spec FR-018 / design 红线）：
1. 所有 `interrupt()` 只负责「展示 + 收输入」，副作用（LLM 判定、写进度）放在没有
   interrupt 的相邻节点里，避免 LangGraph 节点重放导致重复调用 LLM。
2. 所有条件边只看 state 字段，AI 输出不参与路由。
"""

from __future__ import annotations

from typing import Any

from langgraph.graph import END, START, StateGraph
from langgraph.types import interrupt

from src.course_agent import agents, mistake_repository, progress_repository
from src.course_agent.course_repository import get_lesson
from src.course_agent.lesson_state import LessonState
from src.course_agent.text_match import is_match

MAX_INTRO_ATTEMPTS = 2  # 跟读不通过重试次数上限（spec FR-007）
MAX_EXERCISE_ATTEMPTS = 2  # 练习题答错重试次数上限（spec FR-009）

# 进度里 stage → 进入该 stage 的节点
_STAGE_ENTRY = {
    "intro": "present_scene",
    "knowledge": "knowledge_prepare",
    "exercise": "exercise_present",
    "roleplay": "roleplay_present",
    "summary": "summary_prepare",
}


# ---------------- 载入与快进 ----------------


def load_lesson_context(state: LessonState) -> dict[str, Any]:
    """载入课时数据，并把进度文件里的位置映射成初始 state（支持断点续学）。"""
    lesson = get_lesson(state["lesson_id"])
    if lesson is None:
        raise ValueError(f"lesson not found: {state['lesson_id']}")

    prog = progress_repository.get_lesson_progress(state["lesson_id"]) or {}
    completed = list(prog.get("completed_stages", []))
    stage = prog.get("current_stage") or "intro"
    answered = dict(prog.get("answered", {}))
    transcript = list(prog.get("roleplay_transcript", []))

    return {
        "lesson": lesson,
        "course_id": lesson["course_id"],
        "chapter_id": lesson["chapter_id"],
        "course_name": lesson["course_name"],
        "chapter_name": lesson["chapter_name"],
        "target_sentence": lesson["target_sentence"],
        "stage": stage,
        "retry_count": int(prog.get("retry_counts", {}).get("intro", 0)),
        "knowledge_prompt": None,
        "knowledge_feedback": None,
        "knowledge_attempts": 0,
        "exercise_index": len(answered),
        "exercise_attempts": 0,
        "exercise_result": None,
        "exercise_hint": None,
        "answered": answered,
        "roleplay_round": sum(1 for m in transcript if m.get("role") == "user"),
        "roleplay_messages": transcript,
        "roleplay_hint": None,
        "evaluations": [],
        "summary": None,
        "progress": prog,
        "typed_ok": False,
        "done": False,
        "degraded": False,
        "error": None,
    }


def route_from_load(state: LessonState) -> str:
    return _STAGE_ENTRY.get(state.get("stage", "intro"), "present_scene")


# ---------------- 环节 1：场景 + 跟读 ----------------


def present_scene(state: LessonState) -> dict[str, Any]:
    """场景导入（纯数据节点，payload 由 user_type_sentence 统一下发）。"""
    return {"stage": "intro"}


def present_target_sentence(state: LessonState) -> dict[str, Any]:
    return {"stage": "intro"}


def user_type_sentence(state: LessonState) -> dict[str, Any]:
    """跟读输入（interrupt）；重试时 payload 带上一次的反馈与剩余次数。"""
    lesson = state["lesson"]
    attempts = int(state.get("retry_count", 0))
    return {
        "user_input": interrupt(
            {
                "stage": "intro",
                "payload": {
                    "lesson_name": lesson.get("name", ""),
                    "scene": lesson.get("scene", ""),
                    "target_sentence": lesson["target_sentence"],
                    "tts_text": lesson["target_sentence"],
                    "attempts": attempts,
                    "max_attempts": MAX_INTRO_ATTEMPTS,
                    "feedback": "还不够准确，再试一次～" if attempts else None,
                    "hint": "注意原句里的关键词，逐词对照一下",
                },
            }
        )
    }


def check_typed_sentence(state: LessonState) -> dict[str, Any]:
    """确定性比对（无 LLM、无 interrupt，可安全重试）。"""
    ok = is_match(state.get("user_input", ""), state["target_sentence"])
    retry = int(state.get("retry_count", 0))

    if ok or retry >= MAX_INTRO_ATTEMPTS:
        stt = {"typed_ok": True, "stage": "knowledge"}
        progress_repository.upsert_lesson(
            state["lesson_id"],
            {
                "status": "in_progress",
                "current_stage": "knowledge",
                "completed_stages": ["intro"],
                "retry_counts": {"intro": retry},
            },
        )
        return stt

    progress_repository.upsert_lesson(
        state["lesson_id"],
        {
            "status": "in_progress",
            "current_stage": "intro",
            "completed_stages": [],
            "retry_counts": {"intro": retry + 1},
        },
    )
    return {"typed_ok": False, "retry_count": retry + 1, "stage": "intro"}


def route_after_check(state: LessonState) -> str:
    return "knowledge_prepare" if state.get("typed_ok") else "user_type_sentence"


# ---------------- 环节 2：知识点（AI 主动提问 + 引导） ----------------


def knowledge_prepare(state: LessonState) -> dict[str, Any]:
    """AI 主动生成一个检验理解的问题（无 interrupt，避免节点重放重复调 LLM）。"""
    lesson = state["lesson"]
    prompt = agents.generate_teaching_prompt(
        lesson.get("name", ""),
        state["target_sentence"],
        list(lesson.get("knowledge_points", [])),
    )
    return {"knowledge_prompt": prompt, "stage": "knowledge"}


def teach_knowledge(state: LessonState) -> dict[str, Any]:
    """展示知识点 + AI 主动提问，收集学习者的即兴作答。"""
    lesson = state["lesson"]
    prompt = state.get("knowledge_prompt") or {}
    return {
        "user_input": interrupt(
            {
                "stage": "knowledge",
                "payload": {
                    "points": lesson.get("knowledge_points", []),
                    "question": prompt.get("question"),
                    "hint": prompt.get("hint"),
                    "attempts": int(state.get("knowledge_attempts", 0)),
                },
            }
        )
    }


def knowledge_evaluate(state: LessonState) -> dict[str, Any]:
    """评价学习者的即兴作答并给出引导；选择直接开始练习时不评价。"""
    answer = str(state.get("user_input", "")).strip()
    prompt = state.get("knowledge_prompt") or {}

    if answer in {"ok", "continue", "skip", ""}:
        feedback: dict[str, Any] | None = None
    else:
        feedback = agents.coach_knowledge_answer(
            str(prompt.get("question", "")), answer, state["target_sentence"]
        )

    progress_repository.upsert_lesson(
        state["lesson_id"],
        {
            "status": "in_progress",
            "current_stage": "exercise",
            "completed_stages": ["intro", "knowledge"],
        },
    )
    return {
        "knowledge_feedback": feedback,
        "knowledge_attempts": int(state.get("knowledge_attempts", 0)) + 1,
        "stage": "exercise",
    }


def knowledge_feedback_present(state: LessonState) -> dict[str, Any]:
    """展示 AI 对即兴作答的点评与引导，用户确认后进入练习。"""
    lesson = state["lesson"]
    prompt = state.get("knowledge_prompt") or {}
    return {
        "user_input": interrupt(
            {
                "stage": "knowledge",
                "payload": {
                    "points": lesson.get("knowledge_points", []),
                    "question": prompt.get("question"),
                    "hint": prompt.get("hint"),
                    "result": state.get("knowledge_feedback"),
                    "needs_confirm": True,
                    "attempts": int(state.get("knowledge_attempts", 0)),
                },
            }
        )
    }


def route_after_knowledge(state: LessonState) -> str:
    # 有作答 → 先展示 AI 点评与引导；直接开始练习 → 跳过点评
    return "knowledge_feedback_present" if state.get("knowledge_feedback") else "exercise_present"


# ---------------- 环节 3：练习（多题循环） ----------------


def exercise_present(state: LessonState) -> dict[str, Any]:
    lesson = state["lesson"]
    index = int(state.get("exercise_index", 0))
    exercises = lesson.get("exercises", [])

    exercise = exercises[index]
    return {
        "user_input": interrupt(
            {
                "stage": "exercise",
                "payload": {
                    "exercise_index": index + 1,
                    "exercise_total": len(exercises),
                    "question": exercise.get("question", ""),
                    "attempts": int(state.get("exercise_attempts", 0)),
                    "max_attempts": MAX_EXERCISE_ATTEMPTS,
                    "result": state.get("exercise_result"),
                    "reference_answer": (
                        exercise.get("reference_answer")
                        if int(state.get("exercise_attempts", 0)) >= MAX_EXERCISE_ATTEMPTS
                        else None
                    ),
                    "degraded": bool(state.get("degraded", False)),
                    "hint": state.get("exercise_hint"),
                },
            }
        )
    }


def exercise_evaluate(state: LessonState) -> dict[str, Any]:
    """作答评价（LLM 或规则兜底），推进到下一题或同题重试。"""
    lesson = state["lesson"]
    index = int(state.get("exercise_index", 0))
    exercises = lesson.get("exercises", [])
    # 防御：所有题目已处理完 → 统一让 route_after_exercise 进 roleplay_present
    if index >= len(exercises):
        return {"exercise_verdict_passed": True, "stage": "roleplay"}

    exercise = exercises[index]
    answer = str(state.get("user_input", "")).strip()
    attempts = int(state.get("exercise_attempts", 0))

    if answer == "__hint__":
        # 主动引导：给分层提示但不消耗作答次数，答完/看完后回到本题
        hint = agents.exercise_hint(
            exercise.get("question", ""),
            exercise.get("reference_answer", ""),
            list(exercise.get("key_points", [])),
            attempts,
        )
        return {
            "exercise_hint": hint.get("hint", ""),
            "exercise_verdict_passed": False,
            "stage": "exercise",
        }

    if answer == "skip":
        # 看答案解析后确认：计入已完成，让 route_after_exercise → exercise_feedback → 再推进
        answered = {**state.get("answered", {}), exercise["id"]: ""}
        progress_repository.upsert_lesson(
            state["lesson_id"],
            {"status": "in_progress", "current_stage": "exercise", "answered": answered},
        )
        next_index = index + 1
        return {
            "exercise_index": next_index,
            "exercise_attempts": 0,
            "exercise_result": None,
            "exercise_hint": None,
            "exercise_verdict_passed": True,
            "answered": answered,
            "evaluations": state.get("evaluations", []) + [{"stage": "exercise", "verdict": "skipped"}],
            "stage": "exercise" if next_index < len(exercises) else "roleplay",
        }

    result = agents.evaluate_answer(
        exercise.get("question", ""),
        answer,
        exercise.get("reference_answer", ""),
        list(exercise.get("key_points", [])),
    )
    verdict = result.get("verdict", "incorrect")
    degraded = bool(state.get("degraded", False))
    passed = verdict in ("correct", "acceptable")

    if not passed:
        # 错题本：答错即记录（含重试后仍错）；同一题重复答错由仓库去重累加。
        # 本节点无 interrupt，副作用不会因节点重放而重复触发。
        mistake_repository.record(
            lesson_id=state["lesson_id"],
            lesson_name=lesson.get("name", ""),
            course_id=state.get("course_id", lesson.get("course_id", "")),
            course_name=state.get("course_name", ""),
            exercise=exercise,
            user_answer=answer,
            evaluation=result,
        )

    if passed or attempts + 1 >= MAX_EXERCISE_ATTEMPTS:
        # 通过 / 重试满额：先由 exercise_feedback 展示评价与参考答案，再进入下一题或下一环节
        answered = {**state.get("answered", {}), exercise["id"]: answer}
        progress_repository.upsert_lesson(
            state["lesson_id"],
            {"status": "in_progress", "current_stage": "exercise", "answered": answered},
        )
        return {
            "exercise_attempts": attempts + 1,
            "exercise_result": result,
            "exercise_hint": None,
            "exercise_verdict_passed": True,
            "answered": answered,
            "evaluations": state.get("evaluations", []) + [{"stage": "exercise", **result}],
            "stage": "exercise",
            "degraded": degraded,
        }

    return {
        "exercise_attempts": attempts + 1,
        "exercise_result": result,
        "exercise_hint": None,
        "exercise_verdict_passed": False,
        "stage": "exercise",
        "degraded": degraded,
    }


def exercise_feedback(state: LessonState) -> dict[str, Any]:
    """单题收尾（interrupt）：展示本题评价与参考答案，用户确认后推进。"""
    lesson = state["lesson"]
    index = int(state.get("exercise_index", 0))
    exercises = lesson.get("exercises", [])
    exercise = exercises[index]

    interrupt(
        {
            "stage": "exercise",
            "payload": {
                "exercise_index": index + 1,
                "exercise_total": len(exercises),
                "question": exercise.get("question", ""),
                "attempts": int(state.get("exercise_attempts", 0)),
                "max_attempts": MAX_EXERCISE_ATTEMPTS,
                "result": state.get("exercise_result"),
                "reference_answer": exercise.get("reference_answer", ""),
                "needs_confirm": True,
                "degraded": bool(state.get("degraded", False)),
            },
        }
    )

    next_index = index + 1
    return {
        "exercise_index": next_index,
        "exercise_attempts": 0,
        "exercise_result": None,
        "exercise_hint": None,
        "exercise_verdict_passed": False,
        "stage": "exercise" if next_index < len(exercises) else "roleplay",
    }


def route_after_exercise(state: LessonState) -> str:
    # verdict_passed=True → exercise_feedback（展示评价），False → 同题重试
    # 防御：若 stage 已被推进到 roleplay（所有题已处理完），直接去 roleplay_present
    if state.get("stage") != "exercise":
        return "roleplay_present"
    return "exercise_feedback" if state.get("exercise_verdict_passed") else "exercise_present"


def route_after_feedback(state: LessonState) -> str:
    return "exercise_present" if state.get("stage") == "exercise" else "roleplay_present"


# ---------------- 环节 4：角色扮演 ----------------


def roleplay_present(state: LessonState) -> dict[str, Any]:
    lesson = state["lesson"]
    roleplay = lesson.get("roleplay", {})
    max_rounds = int(roleplay.get("max_rounds", 3))
    round_no = int(state.get("roleplay_round", 0))

    if round_no >= max_rounds:
        return {"user_input": "finish"}

    messages = state.get("roleplay_messages", [])
    if messages and messages[-1].get("role") == "assistant":
        ai_message = messages[-1].get("text", "")
        last_eval = messages[-1].get("evaluation")
    else:
        ai_message = roleplay.get("opening_line", "")
        last_eval = None

    return {
        "user_input": interrupt(
            {
                "stage": "roleplay",
                "payload": {
                    "role": roleplay.get("role", ""),
                    "setting": roleplay.get("setting", ""),
                    "goal": roleplay.get("goal", ""),
                    "round": round_no + 1,
                    "max_rounds": max_rounds,
                    "ai_message": ai_message,
                    "evaluation": last_eval,
                    "hint": state.get("roleplay_hint"),
                },
            }
        )
    }


def roleplay_evaluate(state: LessonState) -> dict[str, Any]:
    lesson = state["lesson"]
    roleplay = lesson.get("roleplay", {})
    max_rounds = int(roleplay.get("max_rounds", 3))
    round_no = int(state.get("roleplay_round", 0))
    text = str(state.get("user_input", "")).strip()
    messages = list(state.get("roleplay_messages", []))

    if text == "finish" or round_no >= max_rounds:
        progress_repository.upsert_lesson(
            state["lesson_id"],
            {
                "status": "in_progress",
                "current_stage": "summary",
                "completed_stages": ["intro", "knowledge", "exercise", "roleplay"],
                "roleplay_transcript": messages,
            },
        )
        return {"stage": "summary", "roleplay_messages": messages}

    if text == "__hint__":
        # 主动引导：卡壳时给切入点提示，不推进轮次、不评价
        last_ai = (
            messages[-1].get("text", "")
            if messages and messages[-1].get("role") == "assistant"
            else roleplay.get("opening_line", "")
        )
        hint = agents.roleplay_hint(
            roleplay.get("role", ""),
            roleplay.get("setting", ""),
            roleplay.get("goal", ""),
            last_ai,
        )
        return {"roleplay_hint": hint.get("hint", ""), "stage": "roleplay"}

    evaluation = agents.evaluate_roleplay_turn(text, roleplay.get("goal", ""))
    messages.append({"role": "user", "text": text, "evaluation": evaluation})

    next_round = round_no + 1
    if next_round < max_rounds:
        reply = agents.roleplay_reply(
            messages,
            roleplay.get("role", ""),
            roleplay.get("setting", ""),
            roleplay.get("opening_line", ""),
        )
        messages.append({"role": "assistant", "text": reply, "evaluation": None})

    progress_repository.upsert_lesson(
        state["lesson_id"],
        {
            "status": "in_progress",
            "current_stage": "roleplay" if next_round < max_rounds else "summary",
            "completed_stages": ["intro", "knowledge", "exercise"],
            "roleplay_transcript": messages,
        },
    )

    return {
        "roleplay_round": next_round,
        "roleplay_messages": messages,
        "roleplay_hint": None,
        "evaluations": state.get("evaluations", []) + [{"stage": "roleplay", **evaluation}],
        "stage": "roleplay" if next_round < max_rounds else "summary",
    }


def route_after_roleplay(state: LessonState) -> str:
    return "summary_prepare" if state.get("stage") == "summary" else "roleplay_present"


# ---------------- 环节 5：总结与落盘 ----------------


def summary_prepare(state: LessonState) -> dict[str, Any]:
    lesson = state["lesson"]
    summary = agents.generate_summary(
        lesson.get("name", ""),
        state["target_sentence"],
        list(state.get("evaluations", [])),
    )
    return {"summary": summary, "stage": "summary"}


def summary_present(state: LessonState) -> dict[str, Any]:
    lesson = state["lesson"]
    summary = state.get("summary") or {}
    total_exercises = len(lesson.get("exercises", []))
    answered = state.get("answered", {})
    interrupt(
        {
            "stage": "summary",
            "payload": {
                "summary": summary.get("summary", ""),
                "suggestions": summary.get("suggestions", []),
                "scores": {
                    "intro": "passed",
                    "exercise": f"{len(answered)}/{total_exercises}",
                    "roleplay_rounds": int(state.get("roleplay_round", 0)),
                },
                "degraded": bool(state.get("degraded", False)),
            },
        }
    )
    return {}


def update_progress(state: LessonState) -> dict[str, Any]:
    progress = progress_repository.upsert_lesson(
        state["lesson_id"],
        {
            "status": "completed",
            "current_stage": "completed",
            "completed_stages": ["intro", "knowledge", "exercise", "roleplay", "summary"],
            "answered": state.get("answered", {}),
            "roleplay_transcript": state.get("roleplay_messages", []),
            "retry_counts": {"intro": int(state.get("retry_count", 0))},
        },
    )
    return {"progress": progress}


def finalize_lesson(state: LessonState) -> dict[str, Any]:
    return {"done": True, "stage": "completed"}


# ---------------- 图构建 ----------------


def build_lesson_graph(with_checkpointer: bool = True):
    """编译课时图。

    - `with_checkpointer=True`：HTTP 自定义路由使用，内存 checkpointer 支撑同进程中断/续跑
          （续学位置仍以 progress.json 为准，见 research R2）。
    - `with_checkpointer=False`：供 langgraph.json 注册给 LangGraph API/Studio 使用，
          该平台自带持久化，自带 checkpointer 会导致图加载失败。
    """

    graph = StateGraph(LessonState)
    graph.add_node("load_lesson_context", load_lesson_context)
    graph.add_node("present_scene", present_scene)
    graph.add_node("present_target_sentence", present_target_sentence)
    graph.add_node("user_type_sentence", user_type_sentence)
    graph.add_node("check_typed_sentence", check_typed_sentence)
    graph.add_node("knowledge_prepare", knowledge_prepare)
    graph.add_node("teach_knowledge", teach_knowledge)
    graph.add_node("knowledge_evaluate", knowledge_evaluate)
    graph.add_node("knowledge_feedback_present", knowledge_feedback_present)
    graph.add_node("exercise_present", exercise_present)
    graph.add_node("exercise_evaluate", exercise_evaluate)
    graph.add_node("exercise_feedback", exercise_feedback)
    graph.add_node("roleplay_present", roleplay_present)
    graph.add_node("roleplay_evaluate", roleplay_evaluate)
    graph.add_node("summary_prepare", summary_prepare)
    graph.add_node("summary_present", summary_present)
    graph.add_node("update_progress", update_progress)
    graph.add_node("finalize_lesson", finalize_lesson)

    graph.add_edge(START, "load_lesson_context")
    graph.add_conditional_edges("load_lesson_context", route_from_load)
    graph.add_edge("present_scene", "present_target_sentence")
    graph.add_edge("present_target_sentence", "user_type_sentence")
    graph.add_edge("user_type_sentence", "check_typed_sentence")
    graph.add_conditional_edges("check_typed_sentence", route_after_check)
    graph.add_edge("knowledge_prepare", "teach_knowledge")
    graph.add_edge("teach_knowledge", "knowledge_evaluate")
    graph.add_conditional_edges("knowledge_evaluate", route_after_knowledge)
    graph.add_edge("knowledge_feedback_present", "exercise_present")
    graph.add_edge("exercise_present", "exercise_evaluate")
    graph.add_conditional_edges("exercise_evaluate", route_after_exercise)
    graph.add_conditional_edges("exercise_feedback", route_after_feedback)
    graph.add_edge("roleplay_present", "roleplay_evaluate")
    graph.add_conditional_edges("roleplay_evaluate", route_after_roleplay)
    graph.add_edge("summary_prepare", "summary_present")
    graph.add_edge("summary_present", "update_progress")
    graph.add_edge("update_progress", "finalize_lesson")
    graph.add_edge("finalize_lesson", END)

    if with_checkpointer:
        from langgraph.checkpoint.memory import InMemorySaver

        return graph.compile(checkpointer=InMemorySaver())
    return graph.compile()
