"""课程数据读取单测（只读真实 courses.json，不依赖网络）。"""

import pytest

from src.course_agent import course_repository as repo


def test_catalog_has_categories_and_courses():
    catalog = repo.load_catalog()
    assert isinstance(catalog["categories"], list)
    assert catalog["categories"], "至少有一个分类"
    course = catalog["categories"][0]["courses"][0]
    assert course["id"] == "mood-today"
    assert len(course["chapters"]) == 3


def test_iter_lessons_returns_flat_list_with_meta():
    lessons = repo.iter_lessons()
    assert len(lessons) >= 3, "至少有一门课的 3 个课时"
    # 校验每条记录都带课程/章节元信息且字段非空
    for lesson in lessons:
        assert lesson["course_id"]
        assert lesson["chapter_id"]
        assert lesson["name"]
        assert lesson["id"]


def test_get_lesson_existing_and_missing():
    lesson = repo.get_lesson("mood-today-l1")
    assert lesson is not None
    assert lesson["target_sentence"].startswith("I'm in a really good mood")

    assert repo.get_lesson("not-exist") is None


def test_lesson_count_by_course():
    counts = repo.lesson_count_by_course()
    assert counts["mood-today"] == 3


# 覆盖数据中所有课时，确保每一条都满足五个环节的最小数据约束
_ALL_LESSON_IDS = [lesson["id"] for lesson in repo.iter_lessons()]


@pytest.mark.parametrize("lesson_id", _ALL_LESSON_IDS)
def test_every_lesson_is_playable(lesson_id):
    """每课时都必须具备五个环节所需的最小数据（data-model 约束）。"""
    lesson = repo.get_lesson(lesson_id)
    assert lesson
    assert lesson["scene"]
    assert lesson["target_sentence"]
    assert len(lesson["knowledge_points"]) >= 1
    assert len(lesson["exercises"]) >= 1
    assert lesson["roleplay"]["opening_line"]
    assert lesson["roleplay"]["max_rounds"] == 3
    for exercise in lesson["exercises"]:
        assert exercise["id"]
        assert exercise["question"]
        assert exercise["reference_answer"]


def test_invalid_data_raises(tmp_path, monkeypatch):
    """数据文件缺失时抛 CourseDataError（接口层转 500）。"""
    monkeypatch.setattr(repo, "_COURSES_PATH", tmp_path / "missing.json")
    monkeypatch.setattr(repo, "_cache", None)
    monkeypatch.setattr(repo, "_cache_mtime", None)
    with pytest.raises(repo.CourseDataError):
        repo.load_catalog()
