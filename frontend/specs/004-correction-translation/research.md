# Research: 纠错气泡原句翻译（文A）

**Feature**: 004-correction-translation | **Date**: 2026-10-26

本文档记录 Phase 0 全部技术决策。每条含 Decision / Rationale / Alternatives considered。

---

## R1: 翻译数据获取路线——后端按需旁路（照搬 TTS 模式）

**Decision**: 后端在 grammer_tutor 子图内新增翻译旁路：`route_entry` 对 `translate_request: true` 的请求直达 `translate_node`（单次 ChatDeepSeek 纯文本调用），译文写入子图局部 `translation` 字段；前端点「文A」时才发起请求。

**Rationale**:
- grammer_tutor 已是「单图双入口懒加载」结构（`route_entry` 按 `tts_request` 分流，003 评审通过），翻译旁路与 TTS 旁路完全同构，团队对这套模式已有验收与维护经验
- 翻译一句短句对 ChatDeepSeek 是低成本轻任务，无需引入任何第三方翻译服务
- 按需请求意味着用户不点「文A」就零开销，纠错主链耗时不受影响

**Alternatives considered**:
- 随纠错消息透传（在 llm_call_node 的 prompt/schema 里加 translation 字段顺带产出）：每轮纠错都多付翻译 token 与时延，即使译文永远不被查看；纠错主链 prompt 复杂度上升
- 前端直调第三方翻译 API：003 research.md R4 已否决——新外部依赖、API key 暴露前端、译文风格与产品语境不统一

---

## R2: 前端请求通道——无状态 POST /api/runs/wait 直调子图

**Decision**: 翻译客户端复用 003 tts-client.ts 的通道模式：`POST /api/runs/wait`，`assistant_id` 直调 `grammer_tutor`（`NEXT_PUBLIC_TTS_ASSISTANT_ID` 同款环境变量覆盖口），`stream_mode: "values"`，响应按 `data.values ?? data` 兼容解析。

**Rationale**:
- `/runs/wait` 无状态调用已被 003 验证：不依赖不稳定 thread id、不污染对话线程历史（项目记忆：TTS 采用无状态端点的同一理由）
- 直调 `grammer_tutor` 子图是硬约束——父图 talk_agent 的 START→coach→HITL 主链没有 `translate_request` 入口，发父图会挂在 HITL 永远到不了 translate_node（TTS 旁路踩过的同款坑，项目记忆已留档）
- 响应顶层即终态 values 本体（2026-10-26 实测），兼容解析写法直接照抄 tts-client.ts

**Alternatives considered**:
- 走对话线程 `/threads/{id}/runs`：会把旁路任务写进线程历史，且 thread id 生命周期问题 003 已验证不可靠
- 新开独立 FastAPI 端点：违反原则 II（后端已有 LangGraph 平台标准通道，再开端点是重复建设）

---

## R3: 译文缓存与会话内复用——前端 Map 缓存

**Decision**: 前端维护 `Map<messageId, string>` 译文缓存（模块级，同 tts-client 的 blobUrlCache 模式）：首次成功后写入，同会话内重复展开直接命中缓存，零网络请求。

**Rationale**:
- 译文是确定性内容（同原句同译文），缓存无一致性风险
- 满足 spec FR-005 / US3 / SC-003 的最小实现
- tts-client.ts 的 blobUrlCache 已验证该模式（含按 messageId 分组清理），代码风格一致

**Alternatives considered**:
- 后端缓存：跨请求缓存译文收益为零（同一原句很少反复翻译），徒增后端状态
- zustand 全局 store：翻译数据无跨组件共享需求（仅翻译区自身消费），Map 缓存 + hook 局部状态足够，避免过度设计

---

## R4: 翻译 LLM 调用——ChatDeepSeek 纯文本输出

**Decision**: translate_node 用与 tutor 主链相同的 ChatDeepSeek 实例配置（temperature 低），prompt 要求：英→中翻译，译文以中文完整语义为主，中英混杂原句保留必要英文词，仅输出译文本身不带任何解释、前缀或引号。

**Rationale**:
- 复用 `_get_model()` 既有配置路径，无新依赖
- 纯文本输出即可满足 spec（前端只渲染一行译文），不需要 `with_structured_output`，降低解析失败面
- 温度取低值保证译文稳定（翻译是确定性任务，不需创造性）

**Alternatives considered**:
- structured_output 包一层 schema：为单个字符串字段引入解析失败风险与 include_raw 回退复杂度，收益为零
- 独立模型实例/厂商：违反原则 III（复用优先），且无质量依据

---

## R5: 翻译区展示位置——从讲解之后调整到讲解之前

**Decision**: 翻译区渲染位置从当前实现（讲解区之后、✅正确句之前，correction-bubble.tsx L88-98）调整为功能行之下、纠错讲解之上（用户参照截图指定位置，spec Assumptions 第 6 条）：原句行 → 功能行 → 虚线分隔 → **译文行** → 虚线分隔 → 纠错讲解 → 分隔线 → ✅正确句。

**Rationale**:
- 用户提供的参照截图明确显示译文位于功能行正下方第一个内容区（「好好学习。」紧随功能行，上下虚线分隔），当前代码位置（讲解之后）与截图不符
- spec FR-009 已按截图固化布局，plan/tasks/implement 全程以此为准
- 译文在讲解之前符合阅读逻辑：先知道「说的是什么意思」（译文），再看「哪里错了」（讲解）

**Alternatives considered**:
- 维持现状（讲解之后）：与用户明确指定的位置冲突，不采纳

---

## R6: 加载/失败/空输入降级——翻译区三态渲染

**Decision**: 翻译区四态：① loading（加载中动画/文案，替换「暂无翻译」占位）② success（译文文本）③ failed（行内失败文案「翻译获取失败，请重试」，再次点击「文A」或点击文案重试）④ 空原句不请求直接显示不可用提示。请求进行中重复点击/重复展开不重发（hook 内守卫）。

**Rationale**:
- 与 003 FR-012（发音失败静默缺陷）同源的教训：失败必须可见可重试
- 失败文案行内展示在翻译区自身位置（而非 useHint 浮层）——翻译区本就是常驻文本区，失败态占用同一位置视觉更连贯，且不干扰功能行三按钮布局
- 防重复请求守卫与 003 T022（跟读面板 synthesizing 守卫）同款模式

**Alternatives considered**:
- useHint 轻提示（003 T021 模式）：hint 浮层 1.5s 消失，但翻译失败后用户需要稳定的重试入口，常驻行内文案更合适
- 全局 toast：违反 FR-003（无弹窗），且打断音频互斥场景的注意力

---

## R7: 并发与音频互斥影响——翻译不占用音频通道

**Decision**: 翻译为纯文本请求，不接入 audio-manager，不影响 003 全局音频互斥规则；翻译请求与音频播放可并行存在。

**Rationale**: spec Edge Case 已明确二者互不影响；音频互斥的作用域是音频流（sourceId），翻译无音频流身份。

**Alternatives considered**: 无（直接采纳 spec 约定）。
