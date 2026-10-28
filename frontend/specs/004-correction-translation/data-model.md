# Data Model: 纠错气泡原句翻译（文A）

**Feature**: 004-correction-translation | **Date**: 2026-10-26

---

## Entity 1: TranslationResult（前端会话内实体）

一条纠错消息原句对应的中文译文及其获取状态。

| 属性 | 类型 | 说明 |
|---|---|---|
| messageId | string | 所属纠错消息 id（缓存键，同 tts-client 的 blobUrlCache 键模式） |
| rawText | string | 待翻译原句（来源：CorrectionMessageData.raw_text，既有透传字段，不新增） |
| text | string \| null | 译文文本；null = 尚未成功获取 |
| status | "idle" \| "loading" \| "success" \| "failed" | 获取状态机状态 |

**状态机**：

```text
idle ──(展开翻译区且缓存未命中)──→ loading ──(成功)──→ success（写缓存）
                                      │
                                      └──(异常/空译文)──→ failed（可重试）
success ──(重复展开)──→ 直接渲染（零请求）
failed ──(重试)──→ loading
```

**生命周期**：模块级 Map 缓存，随页面会话存在；不跨会话持久化，刷新后重置（spec Edge Case 允许）。

**约束**（来自 spec FR）：
- loading 期间重复触发不重发请求（防重守卫，US1-AC2 / Edge Case 1）
- failed 状态必须行内可见并提供重试路径（FR-003 / US2）
- success 后重复展开零请求（FR-005 / FR-007 / US3）

## Entity 2: 翻译旁路输入（后端 invoke 契约入参）

```text
{ translate_request: true, raw_text: string }
```

- `translate_request`: 声明于 grammer_tutor 子图局部 TutorState（同 tts_request 先例，父图契约无此 key，正常对话链永不携带）
- `raw_text`: 复用既有字段；为空/纯空白时后端不调 LLM，直接返回空译文（spec Edge Case 2）

## Entity 3: 翻译旁路输出（后端终态 values 字段）

| 字段 | 类型 | 说明 |
|---|---|---|
| translation | string | 译文文本；成功为非空中文译文，失败/空输入为空串 ""（不抛错、不阻塞，同 TTS 旁路兜底风格） |

- `translation` 声明于子图局部 TutorState，**不进全局 state.py**（父图链路不产生翻译，前端仅经 /runs/wait 终态读取，项目约定：子图私有字段本地声明）

## 关系与复用边界

- TranslationResult 依附于既有 CorrectionMessageData（003 透传契约），不新增消息类型、不改透传结构
- 翻译请求通道与 TTS 旁路并列共存于同一子图（route_entry 三分支），输入输出互不重叠（tts_request/translate_request 互斥携带）
- 翻译不接入 audio-manager，无 sourceId，不参与音频互斥（research R7）
