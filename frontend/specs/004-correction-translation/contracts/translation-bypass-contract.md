# Contract: 翻译旁路调用契约（前端 invoke ↔ 后端翻译）

**Feature**: 004-correction-translation | **Date**: 2026-10-26

纠错气泡「文A」按钮的按需翻译通道。与 003 TTS 旁路（[tts-bypass-contract.md](../../003-grammar-correction-bubble/contracts/tts-bypass-contract.md)）同构：无状态直调 grammer_tutor 子图，不进对话线程历史。

## 请求

```http
POST /api/runs/wait
Content-Type: application/json
```

```json
{
  "assistant_id": "grammer_tutor",
  "input": {
    "translate_request": true,
    "raw_text": "good good study."
  },
  "stream_mode": "values"
}
```

| 字段 | 必填 | 说明 |
|---|---|---|
| assistant_id | 是 | 固定 `grammer_tutor`（langgraph.json 独立注册键）；前端以 `NEXT_PUBLIC_TTS_ASSISTANT_ID || "grammer_tutor"` 解析，与 TTS 共用覆盖口 |
| input.translate_request | 是 | 旁路标记：`route_entry` 检测到该字段为真时直达 translate_node，不进讲解主链；父图契约无此 key，正常对话链不受影响 |
| input.raw_text | 是 | 待翻译原句；为空/纯空白时后端不调 LLM，直接返回空译文 |

**禁止**：携带 `tts_request`（与 translate_request 互斥；同请求同时携带两者时 route_entry 分支优先级由实现定义，前端不得依赖）；携带 thread_id（无状态调用，不落线程）。

## 响应

`/runs/wait` 响应顶层即终态 values 本体（无 "values" 包装键，2026-10-26 实测；前端按 `data.values ?? data` 兼容解析）。

```json
{
  "translation": "好好学习。"
}
```

| 字段 | 类型 | 成功 | 失败/空输入 |
|---|---|---|---|
| translation | string | 非空中文译文（纯文本，无解释/前缀/引号） | 空串 `""`（不抛错、不报异常，同 TTS 旁路兜底风格） |

## 路由语义（route_entry 三分支）

```text
START ── translate_request 为真 ──→ translate_node ──→ END
START ── tts_request 为真（003 既有）──→ tts_node ──→ END
START ── 两者皆无（父图对话链）──→ load_input_node（讲解主链）
```

## 失败语义与前端处置

| 场景 | 后端表现 | 前端处置 |
|---|---|---|
| 原句为空/纯空白 | 不调 LLM，`translation: ""` | 不发起请求（前端前置校验），翻译区显示不可用提示 |
| LLM 调用异常 | 捕获，`translation: ""` | 空译文视为失败 → 行内「翻译获取失败，请重试」 |
| HTTP 非 2xx / 网络异常 | — | 抛 TranslationClientError → 翻译区 failed 态，可重试（FR-003/US2） |

## 与 003 既有契约的关系

- 纠错消息透传契约（correction-message-contract.md）**不变**：翻译不透传、不进 correction_data
- TTS 旁路契约（tts-bypass-contract.md）**不变**：translate_request 与 tts_request 在同一 route_entry 并列分流，互不干扰
- langgraph.json **不变**：grammer_tutor 注册键复用
