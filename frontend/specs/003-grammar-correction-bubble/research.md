# Research: 子功能-对话演示气泡-语法纠错场景

**Date**: 2026-10-24 | **Status**: 全部决策已定，无遗留 NEEDS CLARIFICATION

调研方式：代码事实核查（backend state.py / talk_graph.py / grammar_tutor_subgraph.py / webapp.py；frontend assistant.tsx / main-chat-page.tsx / 001、002 specs）+ 002 feature 已验证模式复用。

---

## R1: 纠错消息的识别方式（前端如何知道一条 AI 消息是纠错气泡）

**Decision**: 后端最小适配透传 + 前端按消息元数据分支渲染。`talk_graph.py → tutor_reply_message_node` 在构造 AIMessage 时，把纠错结构化数据写入 `additional_kwargs.correction_data`（原句 raw_text、讲解 tutor_reply、修正清单 corrections、发音评分 ise_grade、点评 feedback）；前端在 AI 消息渲染组件里读取该消息的 metadata，存在 `correction_data` 即渲染纠错气泡，否则走普通气泡分支。

**Rationale**: LangGraph state 是全局值而非按消息归属——刷新页面或多条历史纠错气泡场景下，仅靠 state 匹配"最后一条消息"不可靠；消息自带数据是最稳妥的按消息识别方式。assistant-ui 的消息渲染分支（`message.metadata.custom` / metadata 透传）是官方支持的扩展点，符合 Constitution 原则 I。

**Alternatives considered**:
- 仅用 `useLangChainState` 读全局 state 匹配最后一条 AI 消息：零后端改动，但刷新后 state 仅保留最后 values、历史多条气泡识别失败 → 否决（保留为联调回退方案，见 contracts/correction-message-contract.md 的 Fallback）。
- 前端解析 tutor_reply 文本特征（如 ✅ 前缀）识别：脆弱、拿不到结构化 corrections → 否决。

**验证点**: 联调第一个任务即验证 `useStreamRuntime` 映射后的消息能否读到 `additional_kwargs`（assistant-ui 侧经 `message.metadata` 或 `useMessage` 自定义 metadata 访问）；若丢失则启用 Fallback（state 匹配最后一条 + 后端在消息 content 前后附加结构化 JSON 的保底序列化）。该验证纳入 tasks.md T00x 并写入 quickstart.md §0。

---

## R2: TTS 发音的获取方式（双 AI 按钮 / 跟读面板音频）

**Decision**: 前端直接调用既有 LangGraph TTS 旁路。点击发音按钮 → 经既有 `/api` 代理向 langgraph server 发起一次独立 invoke（`POST /api/threads/{thread_id}/runs/wait`，assistant_id=`talk_agent`，input=`{ tts_request: true, raw_text, corrections }`）→ 响应 state values 中取 `raw_audio`（原句）与 `tutor_audio`（正确句）两段 base64 音频 → 解码为 Blob URL 交由全局音频管理器播放。结果缓存于气泡内存（同句第二次点击即播不重合成）。

**Rationale**: 后端子图已实现双入口懒加载旁路（`route_entry` 按 `tts_request` 分流，`tts_node` 合成 raw_audio/tutor_audio，失败返回空字节不阻塞文本），注释明确"前端点发音按钮时 invoke 本图 `{tts_request: True, raw_text, corrections?}`"——完全复用，零后端改动，符合原则 II/III。

**Alternatives considered**:
- 后端新增 REST 路由包一层：多一处后端改动，无收益 → 否决。
- 消息到达时预合成音频随消息透传：拖慢对话主链路、大多数音频不会被播放 → 否决（保持懒加载）。

**关键事实**: webapp.py 仅有一条自定义路由 `POST /audio/transcribe`（001 的 dictation 用），无 TTS 路由 → 走 langgraph 标准 runs API 即可。

---

## R3: 音频播放与全局互斥（FR-005）

**Decision**: 新增 `lib/audio-manager.ts` 全局音频管理器——模块级单例 HTMLAudioElement + zustand 状态（当前播放源、加载/播放/暂停态、进度、倍速、循环）。任何播放请求先停当前源；气泡按钮与跟读面板共用同一实例。base64 → Uint8Array → Blob（`audio/mpeg` 或按讯飞返回格式 `audio/wav`，实现时以实际字节头自适应）→ objectURL。

**Rationale**: 全局互斥是 clarify 决议；单例元素天然满足"同一时刻最多一段声音"，且倍速（playbackRate）、循环（loop + ended 事件重播）、进度（timeupdate）用浏览器原生能力，无需引入音频库。

**Alternatives considered**: Web Audio API（能力过剩、实现重）；每按钮独立 Audio 实例 + 事件协调（互斥逻辑分散易漏）→ 均否决。

---

## R4: 「文A」翻译数据来源（FR-010）

**Decision**: 本次前端仅落地交互框架：点击展开翻译区域，因后端**当前无任何翻译输出字段**（代码全量搜索确认），区域显示明确的"暂无翻译"占位提示；后端译文接入属后续 feature。

**Rationale**: 代码核查：backend/src 下无 translate/翻译相关业务字段（仅 drawio 图内无关文字）。Constitution 原则 II 禁止为 UI 需求重构后端——新增 LLM 翻译节点属新功能而非最小适配。spec Assumptions 已预授权此占位方案。

**Alternatives considered**: 后端加翻译节点（超范围）；前端调第三方翻译 API（引入新外部依赖与密钥管理，绕过后端事实来源）→ 均否决。

---

## R5: 评分条数据来源（FR-011 / US6）

**Decision**: 三项评分按数据有无动态渲染——语法纠错项：`corrections` 非空即展示（标签"继续加油"）；发音项：`ise_grade`（float，讯飞 ISE 总分）存在即展示；地道项：后端**无对应数据源**（代码核查无 idiom 相关字段），默认不展示。`ise_check_results.pronunciation`（逐词分数与建议）为发音分析详情页预留，本期不用。

**Rationale**: 与 spec FR-011"数据缺失项不展示"一致；原型图中"地道 85"暂无后端数据支撑，真实运行该项不出现属预期行为（留档说明，避免验收误解）。

**Alternatives considered**: 地道分前端伪随机/写死：造假数据 → 否决。

---

## R6: 跟读面板实现模式（US4 / FR-006~009）

**Decision**: 复用 002-scene-select-popup 已验证的面板模式——`@base-ui/react` Dialog/Popup 原语 + `tw-animate-css` 底部滑入动画 + zustand 管理面板开关与播放控制状态；播放能力全部委托 `audio-manager`（进度条读 timeupdate，倍速设 playbackRate 即时生效，循环用 loop 开关 + ended 重播，暂停即 pause）。语言切换按 FR-009：英语(美) 可用，英语(英)/中文选项禁用态 + 提示。麦克风按钮为 UI 占位（点击轻提示）。

**Rationale**: 同仓同框架已验证模式直接复用（原则 III），面板控制与气泡播放共享同一全局互斥实例，天然满足 FR-005 跨组件互斥。

**Alternatives considered**: 独立第三方音频播放器组件（新依赖、样式难对齐原型）→ 否决。

---

## R7: 气泡双态渲染与展开/收起（US1 / FR-001/002）

**Decision**: 在既有 AI 消息渲染组件（main-chat-page.tsx 的 MyAssistantMessage 分支）内，按 R1 识别结果分流：纠错气泡组件族 `components/correction-bubble/`（骨架持有展开/收起 state，默认展开；收起态仅渲染原句行 + 功能行，与用户收起态截图一致）；普通消息走现有渲染不动。讲解内容即 `correction_data.tutor_reply` 文本（保留后端产出的分隔线/✅ 格式），✅ 正确句取 `corrections[0].correct`（多条时取首条，与复制/跟读数据源一致）。

**Rationale**: 气泡内局部 state 管展开收起，刷新后回到默认展开态（clarify 决议），无需持久化；组件族拆分便于 tasks 按故事拆解与目视比对。

**Alternatives considered**: 用 zustand 全局管理展开状态（过度设计，无跨组件需求）→ 否决。

---

## 遗留与移交

- 无 NEEDS CLARIFICATION 残留。
- 移交 tasks.md 的验证类任务：R1 additional_kwargs 透传联调验证（第一优先）、R2 base64 音频格式实测、FR-013 回归清单执行。
