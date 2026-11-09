"""LangGraph Server 自定义 HTTP 路由（langgraph.json `http.app` 挂载）.

提供语音端点：
- `POST /audio/transcribe`：语音转写（讯飞 IAT），服务 001 前端语音输入
  （契约：frontend/specs/001-main-tab-shell/contracts/audio-transcribe.md）
- `POST /audio/tts`：文本按需合成（讯飞 TTS），服务 003 发音弹窗的四个播放源
  （契约：frontend/specs/003-pronunciation-info-popup/contracts/audio-tts.md）

不引入鉴权与重试；不改任何 graph 与工具函数实现。
"""

import sys
import uuid
from functools import partial
from pathlib import Path

# 兼容直接运行本文件：把 backend 目录加入 sys.path，使 src.* 绝对导入可用；
# langgraph dev / uv run 下 backend 本就在 sys.path，无副作用
_BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

import anyio  # noqa: E402
from fastapi import FastAPI, Request  # noqa: E402
from fastapi.responses import JSONResponse, Response  # noqa: E402

from src.tools.audio_tool.xfyun_ita.xfyun_iat_tool import (  # noqa: E402
    xfyun_iat_tool_by_audio_data,
)
from src.tools.audio_tool.xfyun_tts.xfyun_tts_tool import (  # noqa: E402
    xfyun_tts_tool_by_text,
)
from src.course_agent import mistake_repository, progress_repository  # noqa: E402
from src.course_agent.course_repository import (  # noqa: E402
    CourseDataError,
    get_lesson,
    lesson_count_by_course,
    load_catalog,
)
from langgraph.types import Command  # noqa: E402

app = FastAPI()

# 300ms 的 16kHz/16bit/单声道 PCM = 16000 samples/s * 2 bytes * 0.3s
_MIN_AUDIO_BYTES = 9600

# 口音 → 讯飞发音人 vcn 映射（仅此一处；audio-tts.md 契约 §3）
# american: x4_EnUs_Laura_education（超拟人英文女声；2026-11-06 试听
#           backend/output/tmp_vcn_check 八段同句合成音频后选定，替换原 vixy）
# british: catherine（英文女声；2026-11-02 用户试听同目录六段音频后选定，SDK 实测可合成）
ACCENT_VCN: dict[str, str | None] = {
    "american": "x4_EnUs_Laura_education",
    "british": "catherine",
}

# 弹窗示范读音/AI 朗读的防御上限（契约 §1：≤ 500 字符）
_MAX_TTS_TEXT_LEN = 500


@app.post("/audio/transcribe")
async def transcribe(request: Request) -> JSONResponse:
    """转写 raw PCM 音频（16kHz/16bit/单声道/小端）为文本（讯飞 IAT）."""
    content_type = request.headers.get("content-type", "").split(";")[0].strip()
    if content_type != "application/octet-stream":
        return JSONResponse(
            status_code=415, content={"detail": "unsupported content-type"}
        )
    audio_data: bytes = await request.body()
    if len(audio_data) < _MIN_AUDIO_BYTES:
        return JSONResponse(status_code=400, content={"detail": "empty audio"})
    try:
        # 讯飞 IAT 流式耗时 1~2s，同步 SDK 放线程池，避免阻塞事件循环
        text: str = await anyio.to_thread.run_sync(
            xfyun_iat_tool_by_audio_data, audio_data
        )
    except Exception as exc:  # 统一错误形态（契约第 2 节）
        return JSONResponse(
            status_code=500, content={"detail": f"transcription failed: {exc}"}
        )
    return JSONResponse(content={"text": text})


@app.post("/audio/tts")
async def tts(request: Request) -> Response:
    """文本按需合成 MP3（讯飞 TTS），供弹窗英音/美音/AI 朗读播放源（契约 audio-tts.md）."""
    content_type = request.headers.get("content-type", "").split(";")[0].strip()
    if content_type != "application/json":
        return JSONResponse(
            status_code=415, content={"detail": "unsupported content-type"}
        )
    try:
        payload = await request.json()
    except Exception:
        return JSONResponse(status_code=400, content={"detail": "invalid json"})
    if not isinstance(payload, dict):
        return JSONResponse(status_code=400, content={"detail": "invalid json"})

    text = payload.get("text")
    accent = payload.get("accent", "american")
    if not isinstance(text, str) or not text.strip():
        return JSONResponse(status_code=400, content={"detail": "empty text"})
    if len(text) > _MAX_TTS_TEXT_LEN:
        return JSONResponse(status_code=400, content={"detail": "text too long"})
    if accent not in ACCENT_VCN:
        return JSONResponse(status_code=400, content={"detail": "unknown accent"})

    vcn = ACCENT_VCN[accent]
    if vcn is None:
        # 英音发音人未经讯飞控制台确认：按契约走 500，前端对该控件置灰（FR-015）
        return JSONResponse(
            status_code=500,
            content={"detail": f"tts failed: accent '{accent}' voice not configured"},
        )

    try:
        # 讯飞 TTS 同步 SDK 放线程池，避免阻塞事件循环（同 /audio/transcribe 模式）
        audio: bytes = await anyio.to_thread.run_sync(
            partial(xfyun_tts_tool_by_text, text.strip(), 50, vcn)
        )
    except Exception as exc:
        return JSONResponse(
            status_code=500, content={"detail": f"tts failed: {exc}"}
        )
    return Response(content=audio, media_type="audio/mpeg", headers={"Cache-Control": "no-store"})


# ---------------- 精品课（frontend/specs/005-premium-course） ----------------

# 课时图的进程内单例：checkpointer 是内存实现，需与请求共用同一实例
_lesson_graph = None


def _get_lesson_graph():
    """懒加载课时图，避免 import 期构造 checkpointer。"""
    global _lesson_graph
    if _lesson_graph is None:
        from src.course_agent.lesson_graph import build_lesson_graph

        _lesson_graph = build_lesson_graph()
    return _lesson_graph


def _stage_response(result: dict, session_id: str, lesson_id: str) -> dict:
    """把图的中断态/终态翻译成前端契约（contracts/lesson-session.md）。"""
    interrupts = result.get("__interrupt__") or ()
    progress = progress_repository.get_lesson_progress(lesson_id) or {}

    if interrupts:
        value = interrupts[0].value if hasattr(interrupts[0], "value") else interrupts[0]
        return {
            "session_id": session_id,
            "stage": value.get("stage", "intro"),
            "payload": value.get("payload", {}),
            "progress": progress,
            "done": False,
        }

    return {
        "session_id": session_id,
        "stage": "completed",
        "payload": {
            "lesson_id": lesson_id,
            "completed_at": progress.get("completed_at"),
        },
        "progress": progress,
        "done": True,
    }


def _catalog_payload() -> dict:
    """目录 + 进度合并（contracts/course-catalog.md）；不向目录泄漏练习题答案。"""
    catalog = load_catalog()
    progress = progress_repository.load()
    counts = lesson_count_by_course()

    categories = []
    total_lessons = 0
    completed_lessons = 0

    for category in catalog.get("categories", []):
        courses = []
        for course in category.get("courses", []):
            chapters = []
            completed_in_course = 0
            lesson_total = counts.get(course.get("id", ""), 0)

            for chapter in course.get("chapters", []):
                lessons = []
                for lesson in chapter.get("lessons", []):
                    status = (progress.get("lessons", {}).get(lesson["id"]) or {}).get(
                        "status", "not_started"
                    )
                    if status == "completed":
                        completed_in_course += 1
                        completed_lessons += 1
                    total_lessons += 1
                    lessons.append(
                        {
                            "id": lesson["id"],
                            "name": lesson.get("name", ""),
                            "order": lesson.get("order", 0),
                            "status": status,
                        }
                    )
                chapters.append(
                    {
                        "id": chapter.get("id", ""),
                        "name": chapter.get("name", ""),
                        "order": chapter.get("order", 0),
                        "lessons": lessons,
                    }
                )

            courses.append(
                {
                    "id": course.get("id", ""),
                    "name": course.get("name", ""),
                    "description": course.get("description", ""),
                    "cover_color": course.get("cover_color", "green"),
                    "order": course.get("order", 0),
                    "lesson_count": lesson_total,
                    "completed_count": completed_in_course,
                    "chapters": chapters,
                }
            )

        categories.append(
            {
                "id": category.get("id", ""),
                "name": category.get("name", ""),
                "order": category.get("order", 0),
                "courses": courses,
            }
        )

    return {
        "categories": categories,
        "summary": {
            "total_lessons": total_lessons,
            "completed_lessons": completed_lessons,
        },
    }


@app.get("/course/catalog")
async def course_catalog() -> JSONResponse:
    """课程目录 + 完成进度（一次返回，前端无需二次请求）。"""
    try:
        return JSONResponse(content=_catalog_payload())
    except CourseDataError:
        return JSONResponse(status_code=500, content={"detail": "course data unavailable"})


@app.get("/course/progress")
async def course_progress() -> JSONResponse:
    """学习进度全量快照。"""
    return JSONResponse(content=progress_repository.load())


@app.get("/course/mistakes")
async def course_mistakes() -> JSONResponse:
    """错题本列表 + 统计（错题由练习环节答错自动记录）。"""
    # 仓库是同步文件 IO；放到线程里跑，避免 LangGraph dev 的 blockbuster 拦截
    mistakes = await anyio.to_thread.run_sync(mistake_repository.list_entries)
    summary = await anyio.to_thread.run_sync(mistake_repository.summary)
    return JSONResponse(content={"mistakes": mistakes, "summary": summary})


@app.post("/course/mistakes/mark")
async def course_mistake_mark(request: Request) -> JSONResponse:
    """标记错题为已掌握 / 重新加入待复习。"""
    try:
        payload = await request.json()
    except Exception:
        return JSONResponse(status_code=400, content={"detail": "invalid json"})
    if not isinstance(payload, dict):
        return JSONResponse(status_code=400, content={"detail": "invalid json"})

    mistake_id = payload.get("id")
    if not isinstance(mistake_id, str) or not mistake_id.strip():
        return JSONResponse(status_code=400, content={"detail": "id required"})

    mastered = payload.get("mastered", True)
    if not isinstance(mastered, bool):
        return JSONResponse(status_code=400, content={"detail": "mastered must be boolean"})

    try:
        entry = await anyio.to_thread.run_sync(
            partial(mistake_repository.mark_mastered, mistake_id.strip(), mastered)
        )
    except Exception as exc:  # 与其它路由一致的稳定错误形态
        return JSONResponse(status_code=500, content={"detail": f"mark failed: {exc}"})
    if entry is None:
        return JSONResponse(status_code=404, content={"detail": "mistake not found"})

    summary = await anyio.to_thread.run_sync(mistake_repository.summary)
    return JSONResponse(content={"mistake": entry, "summary": summary})


@app.post("/course/lesson/start")
async def lesson_start(request: Request) -> JSONResponse:
    """开始课时：跑图到第一个 interrupt，返回首个环节快照。"""
    try:
        payload = await request.json()
    except Exception:
        return JSONResponse(status_code=400, content={"detail": "invalid json"})
    if not isinstance(payload, dict):
        return JSONResponse(status_code=400, content={"detail": "invalid json"})

    lesson_id = payload.get("lesson_id")
    if not isinstance(lesson_id, str) or not lesson_id.strip():
        return JSONResponse(status_code=400, content={"detail": "lesson_id required"})
    lesson_id = lesson_id.strip()

    if get_lesson(lesson_id) is None:
        return JSONResponse(status_code=404, content={"detail": "lesson not found"})

    session_id = f"local:{lesson_id}:{uuid.uuid4().hex[:8]}"
    config = {"configurable": {"thread_id": session_id}}
    try:
        result = await _get_lesson_graph().ainvoke(
            {"lesson_id": lesson_id, "user_id": "local"}, config
        )
    except Exception as exc:  # 图异常不泄露堆栈，返回稳定形态
        return JSONResponse(status_code=500, content={"detail": f"lesson failed: {exc}"})

    return JSONResponse(content=_stage_response(result, session_id, lesson_id))


@app.post("/course/lesson/step")
async def lesson_step(request: Request) -> JSONResponse:
    """推进一步：以用户输入 resume 图，返回下一个环节快照或完成态。"""
    try:
        payload = await request.json()
    except Exception:
        return JSONResponse(status_code=400, content={"detail": "invalid json"})
    if not isinstance(payload, dict):
        return JSONResponse(status_code=400, content={"detail": "invalid json"})

    session_id = payload.get("session_id")
    user_input = payload.get("input")
    if not isinstance(session_id, str) or not session_id.strip():
        return JSONResponse(status_code=400, content={"detail": "session_id required"})
    if not isinstance(user_input, str) or not user_input.strip():
        return JSONResponse(status_code=422, content={"detail": "empty input"})

    # session_id 固定格式：local:<lesson_id>:<8位hex>（lesson_start L278 生成）
    parts = session_id.split(":")
    if len(parts) != 3 or parts[0] != "local" or not parts[1]:
        return JSONResponse(status_code=400, content={"detail": "invalid session_id format"})
    lesson_id = parts[1]
    config = {"configurable": {"thread_id": session_id}}
    try:
        result = await _get_lesson_graph().ainvoke(Command(resume=user_input.strip()), config)
    except Exception:
        # 会话不存在 / 已结束 / 阶段错位：让前端重新 start（contracts §错误约定）
        return JSONResponse(
            status_code=409,
            content={
                "detail": "session out of sync",
                "current_stage": (progress_repository.get_lesson_progress(lesson_id) or {}).get(
                    "current_stage"
                ),
            },
        )

    return JSONResponse(content=_stage_response(result, session_id, lesson_id))
