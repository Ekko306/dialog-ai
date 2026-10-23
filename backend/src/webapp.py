"""LangGraph Server 自定义 HTTP 路由（langgraph.json `http.app` 挂载）.

当前仅提供语音转写端点 `POST /audio/transcribe`，服务 US3 前端语音输入
（契约：frontend/specs/001-main-tab-shell/contracts/audio-transcribe.md）。
不引入鉴权与重试；不改任何 graph 与工具函数实现。
"""

import sys
from pathlib import Path

# 兼容直接运行本文件：把 backend 目录加入 sys.path，使 src.* 绝对导入可用；
# langgraph dev / uv run 下 backend 本就在 sys.path，无副作用
_BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

import anyio  # noqa: E402
from fastapi import FastAPI, Request  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402

from src.tools.audio_tool.xfyun_ita.xfyun_iat_tool import (  # noqa: E402
    xfyun_iat_tool_by_audio_data,
)

app = FastAPI()

# 300ms 的 16kHz/16bit/单声道 PCM = 16000 samples/s * 2 bytes * 0.3s
_MIN_AUDIO_BYTES = 9600


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
