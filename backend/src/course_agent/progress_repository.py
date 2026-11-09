"""学习进度读写（`data/progress.json`，单用户本机）.

写入采用「临时文件 + os.replace」原子替换，进程内用 `threading.Lock` 串行化，
避免 dev server 并发请求写坏文件（research R3）。
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
_PROGRESS_PATH = _DATA_DIR / "progress.json"
_lock = threading.Lock()


def _default() -> dict[str, Any]:
    """每次返回全新的默认结构，避免共享 dict 被 upsert 污染。"""
    return {"version": 1, "updated_at": None, "lessons": {}}


def _now() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def _read() -> dict[str, Any]:
    if not _PROGRESS_PATH.exists():
        return _default()
    try:
        with _PROGRESS_PATH.open(encoding="utf-8") as fh:
            data = json.load(fh)
    except (json.JSONDecodeError, OSError):
        # 文件损坏不阻断学习：退回空进度，下次写入时重建
        return _default()
    if not isinstance(data, dict) or not isinstance(data.get("lessons"), dict):
        return _default()
    return data


def _write(data: dict[str, Any]) -> None:
    _DATA_DIR.mkdir(parents=True, exist_ok=True)
    data["updated_at"] = _now()
    fd, tmp_path = tempfile.mkstemp(dir=_DATA_DIR, prefix=".progress-", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, indent=2)
        os.replace(tmp_path, _PROGRESS_PATH)
    except BaseException:
        Path(tmp_path).unlink(missing_ok=True)
        raise


def load() -> dict[str, Any]:
    """返回进度全量快照（深拷贝，避免调用方误改内部状态）。"""
    with _lock:
        return json.loads(json.dumps(_read()))


def get_lesson_progress(lesson_id: str) -> dict[str, Any] | None:
    with _lock:
        return json.loads(json.dumps(_read()["lessons"].get(lesson_id)))


def upsert_lesson(lesson_id: str, patch: dict[str, Any]) -> dict[str, Any]:
    """合并写入某课时的进度，返回写入后的该条记录.

    幂等：已是 completed 时不覆盖 completed_at（spec FR-019）。
    """
    with _lock:
        data = _read()
        entry: dict[str, Any] = data["lessons"].get(lesson_id, {})
        was_completed = entry.get("status") == "completed"

        merged = {**entry, **patch}
        if "started_at" not in merged:
            merged["started_at"] = _now()
        if patch.get("status") == "completed":
            if not was_completed or not merged.get("completed_at"):
                merged["completed_at"] = _now()
        merged.setdefault("completed_at", None)

        data["lessons"][lesson_id] = merged
        _write(data)
        return json.loads(json.dumps(merged))
