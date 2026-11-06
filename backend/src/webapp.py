"""LangGraph Server 自定义 HTTP 路由（langgraph.json `http.app` 挂载）.

提供语音端点：
- `POST /audio/transcribe`：语音转写（讯飞 IAT），服务 001 前端语音输入
  （契约：frontend/specs/001-main-tab-shell/contracts/audio-transcribe.md）
- `POST /audio/tts`：文本按需合成（讯飞 TTS），服务 003 发音弹窗的四个播放源
  （契约：frontend/specs/003-pronunciation-info-popup/contracts/audio-tts.md）

不引入鉴权与重试；不改任何 graph 与工具函数实现。
"""

import sys
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
