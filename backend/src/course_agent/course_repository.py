"""课程目录读取（只读，数据源 `data/courses.json`）.

只负责取数据与定位课时；不做任何进度合并（进度见 `progress_repository.py`）。
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

_DATA_DIR = Path(__file__).resolve().parent / "data"
_COURSES_PATH = _DATA_DIR / "courses.json"

# 文件 mtime 缓存：dev server 下每次请求都读文件会有 IO 抖动，但同时要支持热改数据
_cache: dict[str, Any] | None = None
_cache_mtime: float | None = None


class CourseDataError(RuntimeError):
    """课程数据缺失或格式损坏。"""


def _load_raw() -> dict[str, Any]:
    global _cache, _cache_mtime
    try:
        mtime = _COURSES_PATH.stat().st_mtime
    except FileNotFoundError as exc:
        raise CourseDataError(f"course data not found: {_COURSES_PATH}") from exc

    if _cache is not None and _cache_mtime == mtime:
        return _cache

    try:
        with _COURSES_PATH.open(encoding="utf-8") as fh:
            data = json.load(fh)
    except (json.JSONDecodeError, OSError) as exc:
        raise CourseDataError(f"course data invalid: {exc}") from exc

    if not isinstance(data, dict) or not isinstance(data.get("categories"), list):
        raise CourseDataError("course data invalid: missing categories")

    _cache, _cache_mtime = data, mtime
    return data


def load_catalog() -> dict[str, Any]:
    """返回课程目录原始结构（categories → courses → chapters → lessons）。"""
    return _load_raw()


def iter_lessons() -> list[dict[str, Any]]:
    """扁平列出全部课时，附带 course_id / chapter_id 与展示名。"""
    lessons: list[dict[str, Any]] = []
    for category in _load_raw()["categories"]:
        for course in category.get("courses", []):
            for chapter in course.get("chapters", []):
                for lesson in chapter.get("lessons", []):
                    lessons.append(
                        {
                            **lesson,
                            "course_id": course["id"],
                            "course_name": course.get("name", ""),
                            "chapter_id": chapter["id"],
                            "chapter_name": chapter.get("name", ""),
                        }
                    )
    return lessons


def get_lesson(lesson_id: str) -> dict[str, Any] | None:
    """按 lesson_id 取课时；不存在返回 None。"""
    for lesson in iter_lessons():
        if lesson.get("id") == lesson_id:
            return lesson
    return None


def lesson_count_by_course() -> dict[str, int]:
    """每门课程的课时总数，供目录接口计算进度用。"""
    counts: dict[str, int] = {}
    for lesson in iter_lessons():
        counts[lesson["course_id"]] = counts.get(lesson["course_id"], 0) + 1
    return counts
