# Contract: 按需润色旁路（polisher-bypass-client）

**Feature**: 006-idiom-panel | **Date**: 2026-10-27
**同构参照**: specs/003/contracts/tts-bypass-contract.md、specs/004-correction-translation/contracts/translation-bypass-contract.md

## 请求

```http
POST /api/runs/wait
Content-Type: application/json
```

```json
{
  "assistant_id": "polisher",
  "input": { "raw_text": "<纠正后的完整句>" },
  "stream_mode": "values"
}
```

- `assistant_id` 固定直调 langgraph.json 独立注册键 `polisher`（不可发父图 talk_agent——HITL 挂死，003 教训）；保留 `NEXT_PUBLIC_POLISHER_ASSISTANT_ID` 环境变量覆盖口（同 TTS 旁路惯例）
- `input` 仅需 `raw_text`；**不传 `enable_tts`**（tts_node 默认跳过，R2）
- 空串输入不该发生（入口守卫保证纠正句非空）；若发生，后端 `polish_status: "skipped"` 兜底不抛错

## 响应

顶层即终态 values 本体（无 `"values"` 包装键，2026-10-26 实测；按 `data.values ?? data` 兼容解析）：

```json
{
  "polisher": {
    "original_text": "...",
    "polished_text": "...",
    "explanation": "...",
    "polish_comment": "...",
    "polish_status": "success | fallback | skipped",
    "tts_status": "skipped"
  },
  "tutor_audio": "",
  "logger": ["..."]
}
```

## 消费规则

| 场景 | 判定 | 行为 |
|------|------|------|
| 成功 | `polish_status === "success"` 且 `polished_text` 非空且 ≠ 纠正句 | 展示 + 写缓存 |
| 回退 | `polish_status === "fallback"`（polished_text = 纠正句原样） | 展示原样句 + 解释「润色服务暂时不可用…」仍写缓存（确定性结果） |
| 跳过 | `polish_status === "skipped"` | 视同失败态（可重试） |
| 网络失败 | 非 2xx / fetch 异常 | 抛 `PolisherBypassError`，UI 渲染失败态 + 行内重试 |

- 展示判定沿用 005 守卫语义：`polished_text` 与输入句相同（fallback）时仍展示（用户能看到解释），但**不打润色标记**
- 失败不写缓存；fallback/success 写缓存（FR-007）

## 面板发音懒加载（纠错气泡面板专用，R2）

```ts
fetchTtsAudio(correctedSentence, [{ wrong: correctedSentence, correct: polishedText, type: "polish" }])
```

- 复用 `lib/tts-client.ts` 导出的 `fetchTtsAudio`（grammer_tutor TTS 旁路），取返回值 `correct` 位
- Blob URL 存 polisher-bypass-client 自有 `panelAudioCache`（键 `${messageId}:panel-polish`）
- **禁止**经 `getTtsAudioUrl` 调用——其全局缓存键 `${messageId}:correct` 已被纠错气泡本体示范句占用，混用会覆盖导致气泡发音播错句
- 合成失败返回 null → 按钮轻提示「发音获取失败」（同 003 降级语义）

## 不变式（零回归护栏）

1. 本契约不修改任何后端文件、langgraph.json、全局 state
2. 不写对话线程（/runs/wait 无状态语义）
3. tts-client / translation-client 既有缓存与函数签名零改动
