"""错题本读写（`data/mistakes.json`，单用户本机）.

与 `progress_repository` 同构：临时文件 + `os.replace` 原子替换，进程内 `threading.Lock`
串行化，避免 dev server 并发请求写坏文件。

错题以 `<lesson_id>::<exercise_id>` 作为稳定主键：同一题重复答错只累加 `wrong_count`
并刷新作答内容，不产生重复记录；标记「已掌握」后若再次答错会自动回到待复习。
"""

from __future__ import annotations

import json
import os
import tempfile
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

_DATA_DIR = Path(__file__).resolve().parent / "data"
_MISTAKES_PATH = _DATA_DIR / "mistakes.json"
_lock = threading.Lock()

PENDING = "pending"
MASTERED = "mastered"


def _default() -> dict[str, Any]:
    """每次返回全新的默认结构，避免共享 dict 被污染。"""
    return {"version": 1, "updated_at": None, "mistakes": {}}


def _now() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def _read() -> dict[str, Any]:
    if not _MISTAKES_PATH.exists():
        return _default()
    try:
        with _MISTAKES_PATH.open(encoding="utf-8") as fh:
            data = json.load(fh)
    except (json.JSONDecodeError, OSError):
        # 文件损坏不阻断学习：退回空错题本，下次写入时重建
        return _default()
    if not isinstance(data, dict) or not isinstance(data.get("mistakes"), dict):
        return _default()
    return data


def _write(data: dict[str, Any]) -> None:
    _DATA_DIR.mkdir(parents=True, exist_ok=True)
    data["updated_at"] = _now()
    fd, tmp_path = tempfile.mkstemp(dir=_DATA_DIR, prefix=".mistakes-", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, indent=2)
        os.replace(tmp_path, _MISTAKES_PATH)
    except BaseException:
        Path(tmp_path).unlink(missing_ok=True)
        raise


def _mistake_id(lesson_id: str, exercise_id: str) -> str:
    return f"{lesson_id}::{exercise_id}"


def list_entries() -> list[dict[str, Any]]:
    """按最近更新时间倒序列出错题（深拷贝，调用方可安全修改）。"""
    with _lock:
        entries = list(_read()["mistakes"].values())
    entries.sort(key=lambda item: item.get("updated_at") or "", reverse=True)
    return json.loads(json.dumps(entries))


def get(mistake_id: str) -> dict[str, Any] | None:
    with _lock:
        entry = _read()["mistakes"].get(mistake_id)
        return json.loads(json.dumps(entry)) if entry else None


def record(
    *,
    lesson_id: str,
    lesson_name: str,
    course_id: str,
    course_name: str,
    exercise: dict[str, Any],
    user_answer: str,
    evaluation: dict[str, Any],
) -> dict[str, Any]:
    """记录一次答错，返回写入后的错题条目.

    - 新增：`wrong_count` 从 1 开始，状态为 pending；
    - 已存在：累加 `wrong_count`、刷新作答与点评，并把已掌握条回置为 pending。
    """
    exercise_id = str(exercise.get("id", ""))
    key = _mistake_id(lesson_id, exercise_id)
    now = _now()

    with _lock:
        data = _read()
        existing = data["mistakes"].get(key)

        base: dict[str, Any] = {
            "id": key,
            "lesson_id": lesson_id,
            "lesson_name": lesson_name,
            "course_id": course_id,
            "course_name": course_name,
            "exercise_id": exercise_id,
            "question": exercise.get("question", ""),
            "reference_answer": exercise.get("reference_answer", ""),
            "user_answer": user_answer,
            "verdict": evaluation.get("verdict", "incorrect"),
            "feedback": evaluation.get("feedback", ""),
            "suggested": evaluation.get("suggested", ""),
            "updated_at": now,
        }

        if existing:
            entry = {**existing, **base}
            entry["wrong_count"] = int(existing.get("wrong_count", 0)) + 1
            entry["status"] = PENDING
            entry["mastered_at"] = None
        else:
            entry = {
                **base,
                "wrong_count": 1,
                "status": PENDING,
                "created_at": now,
                "mastered_at": None,
            }

        data["mistakes"][key] = entry
        _write(data)
        return json.loads(json.dumps(entry))


def mark_mastered(mistake_id: str, mastered: bool = True) -> dict[str, Any] | None:
    """把错题标记为已掌握 / 重新加入待复习；不存在返回 None。"""
    with _lock:
        data = _read()
        entry = data["mistakes"].get(mistake_id)
        if entry is None:
            return None
        now = _now()
        entry["status"] = MASTERED if mastered else PENDING
        entry["mastered_at"] = now if mastered else None
        entry["updated_at"] = now
        _write(data)
        return json.loads(json.dumps(entry))


def summary() -> dict[str, int]:
    """错题统计：总数 / 待复习 / 已掌握。"""
    with _lock:
        entries = list(_read()["mistakes"].values())
    total = len(entries)
    pending = sum(1 for item in entries if item.get("status") == PENDING)
    return {"total": total, "pending": pending, "mastered": total - pending}
