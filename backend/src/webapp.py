"""LangGraph Server 自定义 HTTP 路由（langgraph.json `http.app` 挂载）.

提供两个音频旁路端点：
- `POST /audio/transcribe` 语音转写（001，契约：specs/001-main-tab-shell/contracts/audio-transcribe.md）
- `POST /audio/evaluate` 发音评测（007，契约：specs/007-pronunciation-analysis/contracts/evaluate-endpoint-contract.md）

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

from src.talk_agent.subgraphs.grammar_check_subgraph.ise_analyze_node import (  # noqa: E402
    parse_ise_xml,
)
from src.tools.audio_tool.xfyun_ita.xfyun_iat_tool import (  # noqa: E402
    xfyun_iat_tool_by_audio_data,
)
from src.tools.audio_tool.xfyun_ise.xfyun_ise_tool import (  # noqa: E402
    xfyun_ise_tool_by_audio_data,
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


@app.post("/audio/evaluate")
async def evaluate(request: Request) -> JSONResponse:
    """评测 raw PCM 音频（16kHz/16bit/单声道/小端）对照 ref_text 的发音（讯飞 ISE）."""
    content_type = request.headers.get("content-type", "").split(";")[0].strip()
    if content_type != "application/octet-stream":
        return JSONResponse(
            status_code=415, content={"detail": "unsupported content-type"}
        )
    audio_data: bytes = await request.body()
    if len(audio_data) < _MIN_AUDIO_BYTES:
        return JSONResponse(status_code=400, content={"detail": "empty audio"})
    ref_text = request.query_params.get("ref_text", "").strip()
    if not ref_text:
        return JSONResponse(status_code=422, content={"detail": "missing ref_text"})
    try:
        # 讯飞 ISE 同步 SDK 放线程池（同 transcribe）；英文引擎 5 分制 → parse 换算百分制
        xml_str: str = await anyio.to_thread.run_sync(
            xfyun_ise_tool_by_audio_data, audio_data, ref_text
        )
        result = parse_ise_xml(xml_str, max_score=5.0)
    except Exception as exc:  # 统一错误形态（契约第 2 节）
        return JSONResponse(
            status_code=500, content={"detail": f"evaluation failed: {exc}"}
        )
    if result is None:  # XML 解析不出 rec_paper（parse_ise_xml 契约）
        return JSONResponse(
            status_code=500, content={"detail": "evaluation failed: unparsable xml"}
        )
    return JSONResponse(content=result)
