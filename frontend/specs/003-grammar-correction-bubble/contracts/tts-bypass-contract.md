# Contract: TTS 旁路调用契约（tts-bypass-contract）

**方向**: frontend `lib/tts-client.ts` → langgraph server（经既有 `/api` 代理）→ `grammer_tutor_subgraph` TTS 旁路
**性质**: 纯复用既有后端能力，零后端改动

## 请求

```
POST /api/runs/wait
Content-Type: application/json

{
  "assistant_id": "grammer_tutor",        // 必须直调 tutor 子图（langgraph.json 独立注册键）：
                                          // 父图 talk_agent 的 START→coach→HITL 主链没有 tts_request
                                          // 入口，发父图会挂在 HITL 永远到不了 tts_node（2026-10-26
                                          // 人工验收实锤）。环境变量 NEXT_PUBLIC_TTS_ASSISTANT_ID 可覆盖
  "input": {
    "tts_request": true,                  // 旁路标记：直达 tts_node，不调用 LLM
    "raw_text": "<用户原句>",             // 必填：原句音频合成源
    "corrections": [ ... ]                // 可选：存在时正确句取 corrections[0].correct；缺省时正确句音频以原句兜底
  },
  "stream_mode": "values"                 // 取终态 values 即可
}
```

**implement 实施修正**：改用无状态 `POST /api/runs/wait`（契约原写 `POST /api/threads/{thread_id}/runs/wait`）。原因：① assistant-ui 运行时不稳定暴露当前 thread id，前端无法可靠取值；② TTS 旁路为无状态任务，无状态端点不残留 run 历史到对话线程，天然避免污染会话记录。输入/输出契约不变，`{tts_request: true}` 旁路分流与 `values.raw_audio/tutor_audio` 出参完全一致。

## 响应

`/runs/wait` 响应**顶层即终态 values 本体**（无 "values" 包装，2026-10-26 实测），取两段音频（后端合成失败时为空串/空字节，不抛错）：

```
raw_audio     # str|bytes：用户原句朗读（base64 经代理传输）
tutor_audio   # str|bytes：正确句朗读
```

前端解析兼容两种形态：`(data.values ?? data)`，防止服务端版本差异。

## 前端处理约定

1. base64 → Uint8Array → Blob；MIME 按字节头探测（`FF FB`/`49 44 33` → audio/mpeg；`52 49 46 46` → audio/wav），探测失败默认 `audio/mpeg`
2. 生成 objectURL 交 `audio-manager` 播放；按 `{messageId}:{raw|correct}` 缓存 Blob，同句复用不再合成
3. 状态映射：请求中 → `loading`（按钮加载态，重复点击不重复发起）；成功 → `playing`；空音频/请求失败 → 失败提示可重试（FR-012），不影响文本展示
4. 播放前先 `audio-manager.stop()` 当前源（全局互斥 FR-005）

## 后端侧参照（只读，不改）

- `grammar_tutor_subgraph.py` L263-309 `tts_node`：合成 raw_audio + tutor_audio
- L319-346 双入口注释：前端 invoke `{tts_request: True, raw_text, corrections?/check_results?}`
- vixy 美音为当前唯一音色（FR-009 英音/中文选项禁用降级的依据）

## 验收对照

- spec FR-004（双按钮两段音频）、FR-005（互斥）、FR-012（失败降级）、US4 跟读面板播放源
- quickstart.md §3（发音）、§4（跟读面板）为验收步
