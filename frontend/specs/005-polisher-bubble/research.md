# Research: 拓展润色气泡（005-polisher-bubble）

**Date**: 2026-10-27 | **原型图**: `frontend/docs/mockups/子功能-对话演示气泡-拓展润色场景.jpg`

## R1 润色句音频合成路径

**Decision**: 复用 003 grammer_tutor TTS 旁路，`corrections` 传润色伪条目 `[{"wrong": raw, "correct": polished, "type": "polish"}]`，`useTtsButton(messageId, "correct", rawText, 伪条目)` 的 correct 音频即润色句。

**Rationale**: langgraph.json 虽已注册 `polisher` 独立子图键，但其入口链是 START→polisher_node→tts_node（无旁路标记），直调会重跑一次 LLM 润色——既浪费 token，又可能产出与气泡上显示的润色句**不一致**的句子（LLM 非确定性），用户跟读/发音的内容和看到的文本对不上是不可接受的。而 grammer_tutor 的 tts_node 对 correct 音频的合成输入就是 `corrections[0].correct`，伪条目数据组织完全符合既有契约，tts-client/use-tts-button/follow-along-panel 零改动复用。

**Alternatives considered**:
- 直调 polisher 子图：❌ 重跑 LLM、结果漂移（见上）
- 后端为 polisher 加旁路标记：❌ 违反原则 II 最小改动，收益为零（伪条目方案已覆盖）
- 前端单独请求新端点：❌ 无此端点，新增违反原则 III

## R2 润色数据前端读取路径

**Decision**: 双路径 + 会话缓存，照抄 003 CorrectionAwareAssistantMessage 已验证模式。

1. **metadata 直读**（非流式/历史回灌）：`s.message.metadata?.custom?.polisher_data`（键名经 additional_kwargs["metadata"] 映射，003 实测唯一可靠键位）
2. **state 同源关联**（流式主路径）：`useLangChainState("polisher", null)` 读顶层 polisher 字典（values 事件完整保留），消息级关联用「消息正文**包含**润色句」（`messageText.includes(polishedText)`）——与 003 的全等匹配不同，因为 polisher_reply_message_node 的正文是多行拼接（"当前语句没有错误…" + "润色建议：…" + 解释），不能用全等
3. **按消息 id 会话级缓存**：`polisherCache: Map<messageId, PolisherMessageData>`，历史气泡持续展示，刷新自然失效

**Rationale**: 2026-10-26 实测教训（项目记忆）：流式链路下 @langchain/langgraph-sdk 重建消息时丢弃 additional_kwargs（仅保留 usage），metadata.custom 只在非流式/历史回灌可靠；values 回声因 content 表示不一致无法覆盖流式版本。003 的补救模式已人工验证可行，直接沿用。

**Alternatives considered**: 仅靠 metadata 直读 ❌（流式下全部丢失）；正文全等匹配 ❌（润色正文是多行拼接非单字段）。

## R3 挂载分流优先级与互斥

**Decision**: `AssistantMessage` 覆盖组件三分流：parseCorrectionData 命中 → 纠错气泡（003 一字不动）；否则 parsePolisherData 命中 → 润色气泡（本 feature）；否则默认渲染。correctionCache / polisherCache 各自独立。

**Rationale**: 后端 has_issue_route 本就二选一（tutor XOR polisher），同一消息不可能同时携带两类数据，分流顺序仅是防御性优先级；US1-AC4 互斥由结构保证。

**Alternatives considered**: 单组件内部条件渲染 ❌（改动 003 组件违反零回归）；新建独立挂载点 ❌（assistant-ui 每消息只有一个 AssistantMessage 扩展点）。

## R4 功能行「AI 发音」与互斥

**Decision**: `useTtsButton(messageId, "raw", rawText, 伪条目)` 播原句——raw kind 的合成输入是 raw_text，corrections 内容不影响 raw 音频（tts-client 契约）。全局音频互斥由 003 audio-manager 单例既有机制继承，无需新代码。

**Rationale**: 与 003 纠错气泡功能行同款；互斥是 audio-manager 层横切能力（跟读面板播放时点发音前一路停，003 T022 已验收）。

## R5 「拓展润色」开关与默认态

**Decision**: 本地 useState 展开态，默认 true（原型图展开态 ∧ 003 先例）；箭头 ChevronUp/ChevronDown 随状态翻转；收起仅隐藏建议区，功能行/操作栏保留在展开态内一并隐藏。

**补充**: 原型图中收起态样式未提供，按 003 纠错气泡收起模式（紧凑两行：原句行 + 功能行）对齐。

## R6 消息正文文案与普通消息降级

**Decision**: 本 feature **不改** polisher_reply_message_node 的正文文案（「当前语句没有错误，没有tutor_reply。」等）。

**Rationale**: 润色气泡渲染时正文被气泡组件替代不显示，文案不可见；无润色产出时正文按普通消息展示（US3 场景1），文案虽偏技术向但改动属于产品文案决策，超出本 feature 边界且会破坏零回归基线。留待独立文案优化任务。

## R7 polisher_data 是否包含 tts_status

**Decision**: 透传字段取 `polisher` 字典的四项：raw_text（original_text）、polished_text、explanation、polish_status。**不含** tts_status / tutor_audio。

**Rationale**: 前端气泡不消费 TTS 状态（音频行为全部走旁路请求 + use-tts-button 自有状态机）；tutor_audio 是 bytes 本轮已随 state 流转，前端无消费场景；契约最小化降低耦合（data-model 契约文档为准）。
