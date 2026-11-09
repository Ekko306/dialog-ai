"""学习进度读写单测：隔离到 tmp_path，不污染真实 progress.json。"""

import json

import pytest

from src.course_agent import progress_repository as repo


@pytest.fixture()
def isolated(tmp_path, monkeypatch):
    monkeypatch.setattr(repo, "_DATA_DIR", tmp_path)
    monkeypatch.setattr(repo, "_PROGRESS_PATH", tmp_path / "progress.json")
    return tmp_path


def test_load_defaults_when_file_missing(isolated):
    data = repo.load()
    assert data["lessons"] == {}


def test_upsert_creates_entry(isolated):
    entry = repo.upsert_lesson("lesson-a", {"status": "in_progress", "current_stage": "intro"})
    assert entry["status"] == "in_progress"
    assert entry["current_stage"] == "intro"
    assert entry["started_at"]

    saved = json.loads((isolated / "progress.json").read_text(encoding="utf-8"))
    assert "lesson-a" in saved["lessons"]
    assert saved["updated_at"]


def test_upsert_merges_patch(isolated):
    repo.upsert_lesson("lesson-a", {"status": "in_progress", "current_stage": "intro"})
    entry = repo.upsert_lesson("lesson-a", {"current_stage": "exercise", "answered": {"ex1": "x"}})
    assert entry["status"] == "in_progress"  # 旧字段保留
    assert entry["current_stage"] == "exercise"
    assert entry["answered"] == {"ex1": "x"}


def test_completed_is_idempotent(isolated):
    """已完成后再写 completed，不覆盖 completed_at（spec FR-019）。"""
    first = repo.upsert_lesson("lesson-a", {"status": "completed"})
    completed_at = first["completed_at"]
    assert completed_at

    second = repo.upsert_lesson("lesson-a", {"status": "completed", "answered": {"ex1": "x"}})
    assert second["completed_at"] == completed_at
    assert second["answered"] == {"ex1": "x"}


def test_get_lesson_progress_returns_copy(isolated):
    repo.upsert_lesson("lesson-a", {"status": "in_progress"})
    got = repo.get_lesson_progress("lesson-a")
    assert got["status"] == "in_progress"

    got["status"] = "tampered"
    assert repo.get_lesson_progress("lesson-a")["status"] == "in_progress"

    assert repo.get_lesson_progress("missing") is None


def test_corrupted_file_does_not_raise(isolated):
    (isolated / "progress.json").write_text("{not json", encoding="utf-8")
    assert repo.load()["lessons"] == {}
    # 写入后文件恢复为合法 JSON
    repo.upsert_lesson("lesson-a", {"status": "in_progress"})
    json.loads((isolated / "progress.json").read_text(encoding="utf-8"))


def test_no_temp_leftover(isolated):
    repo.upsert_lesson("lesson-a", {"status": "in_progress"})
    leftovers = [p.name for p in isolated.iterdir() if p.name.startswith(".progress-")]
    assert leftovers == []
