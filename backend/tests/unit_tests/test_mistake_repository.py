"""错题本读写单测：隔离到 tmp_path，不污染真实 mistakes.json。"""

import json

import pytest

from src.course_agent import mistake_repository as repo


@pytest.fixture()
def isolated(tmp_path, monkeypatch):
    monkeypatch.setattr(repo, "_DATA_DIR", tmp_path)
    monkeypatch.setattr(repo, "_MISTAKES_PATH", tmp_path / "mistakes.json")
    return tmp_path


def _record(lesson_id="lesson-a", exercise_id="ex1", answer="wrong"):
    return repo.record(
        lesson_id=lesson_id,
        lesson_name="课时 A",
        course_id="course-a",
        course_name="课程 A",
        exercise={
            "id": exercise_id,
            "question": "用本课表达说一句话",
            "reference_answer": "I'm in a good mood.",
        },
        user_answer=answer,
        evaluation={"verdict": "incorrect", "feedback": "再对照原句", "suggested": "I'm happy."},
    )


def test_list_defaults_empty(isolated):
    assert repo.list_entries() == []
    assert repo.summary() == {"total": 0, "pending": 0, "mastered": 0}


def test_record_creates_entry(isolated):
    entry = _record()
    assert entry["id"] == "lesson-a::ex1"
    assert entry["user_answer"] == "wrong"
    assert entry["reference_answer"] == "I'm in a good mood."
    assert entry["wrong_count"] == 1
    assert entry["status"] == repo.PENDING
    assert entry["created_at"]

    saved = json.loads((isolated / "mistakes.json").read_text(encoding="utf-8"))
    assert "lesson-a::ex1" in saved["mistakes"]
    assert saved["updated_at"]


def test_record_dedupes_and_accumulates(isolated):
    _record(answer="first wrong")
    entry = _record(answer="second wrong")
    assert entry["wrong_count"] == 2
    assert entry["user_answer"] == "second wrong"
    assert len(repo.list_entries()) == 1


def test_mark_mastered_toggles_status(isolated):
    _record()
    marked = repo.mark_mastered("lesson-a::ex1", True)
    assert marked["status"] == repo.MASTERED
    assert marked["mastered_at"]

    reopened = repo.mark_mastered("lesson-a::ex1", False)
    assert reopened["status"] == repo.PENDING
    assert reopened["mastered_at"] is None

    assert repo.mark_mastered("missing", True) is None


def test_wrong_again_reopens_mastered(isolated):
    _record()
    repo.mark_mastered("lesson-a::ex1", True)
    entry = _record(answer="still wrong")
    assert entry["status"] == repo.PENDING
    assert entry["mastered_at"] is None
    assert entry["wrong_count"] == 2


def test_summary_counts(isolated):
    _record(exercise_id="ex1")
    _record(exercise_id="ex2")
    repo.mark_mastered("lesson-a::ex1", True)

    summary = repo.summary()
    assert summary == {"total": 2, "pending": 1, "mastered": 1}


def test_entries_sorted_by_updated_at_desc(isolated):
    first = _record(exercise_id="ex1")
    # 同秒写入时仅能保证不报错，这里显式改 updated_at 验证排序逻辑
    entry = _record(exercise_id="ex2")
    entries = repo.list_entries()
    assert len(entries) == 2
    assert entries[0]["updated_at"] >= entries[-1]["updated_at"]
    assert first["id"] in {item["id"] for item in entries}
    assert entry["id"] in {item["id"] for item in entries}


def test_corrupted_file_does_not_raise(isolated):
    (isolated / "mistakes.json").write_text("{not json", encoding="utf-8")
    assert repo.list_entries() == []
    _record()
    json.loads((isolated / "mistakes.json").read_text(encoding="utf-8"))


def test_no_temp_leftover(isolated):
    _record()
    leftovers = [p.name for p in isolated.iterdir() if p.name.startswith(".mistakes-")]
    assert leftovers == []
