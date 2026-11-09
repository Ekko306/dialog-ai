"""练习评价节点与错题本的联动：答错落错题本，答对不落。"""

import pytest

from src.course_agent import lesson_graph, mistake_repository, progress_repository


@pytest.fixture()
def isolated(tmp_path, monkeypatch):
    monkeypatch.setattr(progress_repository, "_DATA_DIR", tmp_path)
    monkeypatch.setattr(progress_repository, "_PROGRESS_PATH", tmp_path / "progress.json")
    monkeypatch.setattr(mistake_repository, "_DATA_DIR", tmp_path)
    monkeypatch.setattr(mistake_repository, "_MISTAKES_PATH", tmp_path / "mistakes.json")
    return tmp_path


def _state(answer="wrong answer"):
    return {
        "lesson_id": "lesson-a",
        "lesson": {
            "id": "lesson-a",
            "name": "课时 A",
            "exercises": [
                {
                    "id": "ex1",
                    "question": "用本课表达说一句话",
                    "reference_answer": "I'm in a good mood.",
                    "key_points": ["mood"],
                }
            ],
        },
        "course_id": "course-a",
        "course_name": "课程 A",
        "exercise_index": 0,
        "exercise_attempts": 0,
        "user_input": answer,
        "answered": {},
        "evaluations": [],
    }


def test_incorrect_answer_is_recorded(isolated, monkeypatch):
    monkeypatch.setattr(
        lesson_graph.agents,
        "evaluate_answer",
        lambda *args, **kwargs: {"verdict": "incorrect", "feedback": "再试一次", "suggested": "I'm happy."},
    )

    lesson_graph.exercise_evaluate(_state())

    entries = mistake_repository.list_entries()
    assert len(entries) == 1
    entry = entries[0]
    assert entry["id"] == "lesson-a::ex1"
    assert entry["user_answer"] == "wrong answer"
    assert entry["reference_answer"] == "I'm in a good mood."
    assert entry["course_name"] == "课程 A"
    assert entry["status"] == mistake_repository.PENDING


def test_second_wrong_answer_accumulates(isolated, monkeypatch):
    monkeypatch.setattr(
        lesson_graph.agents,
        "evaluate_answer",
        lambda *args, **kwargs: {"verdict": "incorrect", "feedback": "再试一次", "suggested": ""},
    )

    lesson_graph.exercise_evaluate(_state("first wrong"))
    lesson_graph.exercise_evaluate(_state("second wrong"))

    entries = mistake_repository.list_entries()
    assert len(entries) == 1
    assert entries[0]["wrong_count"] == 2
    assert entries[0]["user_answer"] == "second wrong"


def test_correct_answer_not_recorded(isolated, monkeypatch):
    monkeypatch.setattr(
        lesson_graph.agents,
        "evaluate_answer",
        lambda *args, **kwargs: {"verdict": "correct", "feedback": "很好", "suggested": ""},
    )

    lesson_graph.exercise_evaluate(_state("I'm in a good mood."))

    assert mistake_repository.list_entries() == []
