# Contract: 语音转写端点 `POST /audio/transcribe`

**Branch**: `001-main-tab-shell` | **Date**: 2026-10-21
**提供方**: backend（LangGraph Server 自定义路由，`langgraph.json` `http.app` → `backend/src/webapp.py`）
**消费方**: frontend（`ServerDictationAdapter`，经 Next.js 同源代理 `/api/audio/transcribe`）

> 本契约对应 spec FR-009 与 Constitution 原则 II 已确认的最小后端修改。端点路径避开 LangGraph 内置前缀（/threads、/runs、/assistants 等）。

## 1. 请求

```http
POST /audio/transcribe HTTP/1.1
Host: <langgraph-server>            # 本地 langgraph dev → localhost:2024
Content-Type: application/octet-stream
Content-Length: <N>
Body: <raw PCM 字节>
```

| 项 | 值 | 说明 |
|----|-----|------|
| 方法/路径 | `POST /audio/transcribe` | 经前端代理即 `fetch("/api/audio/transcribe")` |
| Content-Type | `application/octet-stream` | 二进制直传，不用 multipart（体小、免解析） |
| Body | raw PCM，**16kHz / 16bit / 单声道 / 小端** | 讯飞 IAT `xfyun_iat_tool_by_audio_data` 的原生输入格式（aue="raw"） |
| 时长约束 | ≥300ms，≤60s | <300ms 前端直接拦截不上传；上限防误录整段音频撑爆 IAT 单次会话 |

**前端采集链路**（保证格式正确）：`getUserMedia` → `AudioContext({ sampleRate: 16000 })`（浏览器重采样）→ AudioWorklet 收集 Float32 → Int16 PCM → 合并 ArrayBuffer 上传。

## 2. 响应

### 200 OK

```json
{ "text": "转写出的文本内容" }
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `text` | `string` | 完整转写文本（dwa="wpgs" 动态修正后的最终结果）；正常不空，空串视为"未识别到语音"，前端按轻提示处理 |

### 错误

| 状态码 | Body | 场景 | 前端行为 |
|--------|------|------|---------|
| 400 | `{"detail": "empty audio"}` | Body 为空或长度 <300ms 等价字节（约 9.6KB） | 轻提示"未捕获到语音" |
| 415 | `{"detail": "unsupported content-type"}` | Content-Type 非 octet-stream | 理论不可达（适配器固定头），兜底轻提示 |
| 500 | `{"detail": "transcription failed: <原因>"}` | 讯飞凭据缺失/无效、讯飞服务错误、PCM 解析失败 | 轻提示"转写失败，请重试"，会话置 `ended/error`，页面可继续键盘输入 |
| 502/503 | `{"detail": "..."}` | 讯飞连接超时 | 同 500 |

- 所有错误 Body 统一 FastAPI `{"detail": string}` 形态。
- **不引入**鉴权（本地/内网部署；同源校验由 Next.js 代理既有 sec-fetch-site 逻辑承担）。
- **不引入**重试逻辑（前端轻提示由用户重按语音键重试，符合 spec 兜底 A）。

## 3. 后端实现要点（webapp.py）

```python
# backend/src/webapp.py（骨架，实现见 tasks）
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from src.tools.audio_tool.xfyun_ita.xfyun_iat_tool import xfyun_iat_tool_by_audio_data

app = FastAPI()

@app.post("/audio/transcribe")
async def transcribe(request: Request) -> JSONResponse:
    audio_data: bytes = await request.body()
    # 校验 → 调用现有工具函数（不改其实现）→ {"text": ...}
    ...
```

- `langgraph.json` 增加：
  ```json
  "http": { "app": "./src/webapp.py:app" }
  ```
- 函数为同步阻塞调用亦可（讯飞 IAT 流式耗时 1~2s，FastAPI 线程池承接；如需可 `run_in_executor`，实现细节 tasks 定）。
- 不修改 `xfyun_iat_tool_by_audio_data` 与任何 graph 文件。

## 4. 联调自检（契约级验收）

```bash
# 后端起服务后，用现有测试 PCM 验证端点（backend/src/talk_agent/test_resources/iat_pcm_16k.pcm）
curl -s -X POST http://localhost:2024/audio/transcribe \
  -H "Content-Type: application/octet-stream" \
  --data-binary "@backend/src/talk_agent/test_resources/iat_pcm_16k.pcm"
# 期望: {"text":"..."}
```

经代理链路：`curl -s -X POST http://localhost:3000/api/audio/transcribe -H "Content-Type: application/octet-stream" --data-binary "@..."` 应返回同样结果（Next.js dev 端口 3000）。
