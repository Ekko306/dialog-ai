"""知识点 AI 提问/点评，以及练习、角色扮演的主动提示分支。"""

import pytest

from src.course_agent import lesson_graph, progress_repository


@pytest.fixture()
def isolated(tmp_path, monkeypatch):
    monkeypatch.setattr(progress_repository, "_DATA_DIR", tmp_path)
    monkeypatch.setattr(progress_repository, "_PROGRESS_PATH", tmp_path / "progress.json")
    return tmp_path


def _lesson():
    return {
        "id": "lesson-a",
        "name": "课时 A",
        "target_sentence": "I'm in a good mood.",
        "knowledge_points": [
            {"title": "情绪表达", "explanation": "说明心情", "example": "I'm in a good mood today."}
        ],
        "exercises": [
            {
                "id": "ex1",
                "question": "用本课表达造句",
                "reference_answer": "I'm in a good mood.",
                "key_points": ["mood"],
            }
        ],
        "roleplay": {
            "role": "朋友",
            "setting": "见面打招呼",
            "goal": "表达今天的心情",
            "opening_line": "How are you?",
            "max_rounds": 3,
        },
    }


def _knowledge_state(answer, prompt=None):
    return {
        "lesson_id": "lesson-a",
        "lesson": _lesson(),
        "target_sentence": "I'm in a good mood.",
        "knowledge_prompt": prompt if prompt is not None else {"question": "你今天心情怎么样？", "hint": "套用核心句"},
        "knowledge_attempts": 0,
        "user_input": answer,
    }


def test_knowledge_answer_gets_coaching(isolated, monkeypatch):
    monkeypatch.setattr(
        lesson_graph.agents,
        "coach_knowledge_answer",
        lambda *args, **kwargs: {
            "verdict": "acceptable",
            "feedback": "意思清楚",
            "suggested": "I'm in a good mood.",
            "hint": "再说一遍注意语调",
        },
    )

    out = lesson_graph.knowledge_evaluate(_knowledge_state("I'm happy today."))

    assert out["knowledge_feedback"]["verdict"] == "acceptable"
    assert out["knowledge_attempts"] == 1
    assert out["stage"] == "exercise"
    assert lesson_graph.route_after_knowledge(out) == "knowledge_feedback_present"

    prog = progress_repository.get_lesson_progress("lesson-a")
    assert prog["current_stage"] == "exercise"
    assert "knowledge" in prog["completed_stages"]


def test_knowledge_skip_goes_straight_to_exercise(isolated, monkeypatch):
    called = []
    monkeypatch.setattr(
        lesson_graph.agents,
        "coach_knowledge_answer",
        lambda *args, **kwargs: called.append(args) or {},
    )

    out = lesson_graph.knowledge_evaluate(_knowledge_state("ok"))

    assert called == []
    assert out["knowledge_feedback"] is None
    assert lesson_graph.route_after_knowledge(out) == "exercise_present"


def test_exercise_hint_does_not_consume_attempt(isolated, monkeypatch):
    monkeypatch.setattr(
        lesson_graph.agents,
        "exercise_hint",
        lambda *args, **kwargs: {"hint": "先想 mood 这个词"},
    )

    state = {
        "lesson_id": "lesson-a",
        "lesson": _lesson(),
        "exercise_index": 0,
        "exercise_attempts": 1,
        "user_input": "__hint__",
        "answered": {},
    }
    out = lesson_graph.exercise_evaluate(state)

    assert out["exercise_hint"] == "先想 mood 这个词"
    assert out["exercise_verdict_passed"] is False
    assert out["stage"] == "exercise"
    assert "exercise_attempts" not in out


def test_exercise_correct_answer_clears_hint(isolated, monkeypatch):
    monkeypatch.setattr(
        lesson_graph.agents,
        "evaluate_answer",
        lambda *args, **kwargs: {"verdict": "correct", "feedback": "很好", "suggested": ""},
    )

    state = {
        "lesson_id": "lesson-a",
        "lesson": _lesson(),
        "exercise_index": 0,
        "exercise_attempts": 0,
        "exercise_hint": "先想 mood 这个词",
        "user_input": "I'm in a good mood.",
        "answered": {},
    }
    out = lesson_graph.exercise_evaluate(state)

    assert out["exercise_hint"] is None
    assert out["exercise_verdict_passed"] is True


def test_roleplay_hint_does_not_advance_round(isolated, monkeypatch):
    monkeypatch.setattr(
        lesson_graph.agents,
        "roleplay_hint",
        lambda *args, **kwargs: {"hint": "先回应对方的心情，再说自己的"},
    )

    state = {
        "lesson_id": "lesson-a",
        "lesson": _lesson(),
        "roleplay_round": 0,
        "roleplay_messages": [
            {"role": "assistant", "text": "How are you?", "evaluation": None}
        ],
        "user_input": "__hint__",
    }
    out = lesson_graph.roleplay_evaluate(state)

    assert out["roleplay_hint"] == "先回应对方的心情，再说自己的"
    assert out["stage"] == "roleplay"
    assert "roleplay_round" not in out
    assert "roleplay_messages" not in out
