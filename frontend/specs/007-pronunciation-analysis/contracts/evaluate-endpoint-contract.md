# Contract: POST /audio/evaluate 按需评测端点

**Feature**: 007-pronunciation-analysis | **Created**: 2026-10-27
**形态基准**: [webapp.py](file:///d:/langgraphprodaima/dialog-ai/backend/src/webapp.py) 既有 `POST /audio/transcribe`（001 契约同构）

## 请求

```
POST /audio/evaluate?ref_text=<URL编码的被评测句>
Content-Type: application/octet-stream
Body: 裸 PCM（16kHz / 16bit / 单声道 / 小端）
```

- `ref_text` 必填（缺失 422）；被评测句 = 用户原句（转写文本 / 重读时同一参考句）
- PCM 最小长度沿用 transcribe 的 `_MIN_AUDIO_BYTES`（300ms），不足 400

## 响应

### 成功 200

```json
{
  "total": 78.5, "accuracy": 80.1, "fluency": 62.0, "integrity": 100.0,
  "is_rejected": false,
  "words": [
    {"word": "Recently", "score": 88.2, "flags": []},
    {"word": "I", "score": 95.0, "flags": ["替换"]}
  ]
}
```

- 字段与后端 `parse_ise_xml(xml, max_score=5.0)` 输出一一对应（百分制）
- `score: null` = 该词无逐词分（解析缺失），前端不着色不编造
- `is_rejected: true` = 读的内容与参考句不符（讯飞判定）→ 前端按失败语义处理，分数不可信

### 失败（统一 `{detail}` 形态，同 transcribe）

| 状态码 | 场景 |
|---|---|
| 400 | 音频过短（<300ms） |
| 415 | Content-Type 非 octet-stream |
| 422 | 缺 `ref_text`（或空串） |
| 500 | 评测 SDK 异常 / XML 解析失败（`evaluation failed: …`） |

## 前端消费规则

- 200 且 `is_rejected=false` 且 `total != null` → EvaluationResult 写入 evaluationCache（messageId 键）→ ready
- 200 但 `is_rejected=true` 或 `total=null` → failed 态，文案「评测未通过：请按参考句重新朗读」，可重试（重试=重新评测同一段音频或重读）
- 4xx/5xx → failed 态，行内重试
- 网络失败 → 同 failed
- 重读成功 → 覆盖 evaluationCache 同键 → 面板评分区/逐词区刷新；**不写**气泡评分条、**不写**对话线程（FR-005）

## 后端实现边界（Constitution II 留档摘要）

- 仅在 webapp.py 新增本端点（约 30 行），复用 `xfyun_ise_tool_by_audio_data` + `parse_ise_xml` 两个现成函数
- 不改任何 graph/子图/节点/langgraph.json/state 契约；不新增依赖
- 同步 SDK 调用放 `anyio.to_thread.run_sync`（同 transcribe），评测耗时 1~2s 由前端 loading 态覆盖

## 与其他旁路的关系

| 旁路 | 触发 | 端点/直调 | 输入 | 本契约关系 |
|---|---|---|---|---|
| 003 TTS | 气泡发音按钮 | `/runs/wait` 直调 grammer_tutor | 文本 | 无交集；面板「美音」复用其 raw 缓存键 |
| 004 翻译 | 文A 按钮 | `/runs/wait` 直调 grammer_tutor | 文本 | 无交集 |
| 006 润色 | 地道入口 | `/runs/wait` 直调 polisher | 纠正句文本 | 语境润色区块复用，无交集 |
| **007 评测** | 面板打开/重读 | **`/audio/evaluate`**（FastAPI 端点，非 /runs/wait） | **PCM + 文本** | 唯一带二进制输入的旁路；因 ISE 是纯工具调用（无图参与），走 webapp.py 比 /runs/wait 更直接 |
