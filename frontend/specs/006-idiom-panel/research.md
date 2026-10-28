# Research: 语境润色弹窗（地道入口）

**Feature**: 006-idiom-panel | **Date**: 2026-10-27
**原型图**: `frontend/docs/mockups/子功能-对话演示气泡-单击发音或地道-弹出更多信息弹窗.jpg`（语境润色区块）

## R1: 纠错侧按需生成 = 直调 polisher 子图（零后端改动）

**Decision**: 纠错气泡「地道」入口通过无状态 `POST /api/runs/wait` 直调 langgraph.json 已注册的 `polisher` 子图，输入 `{raw_text: <纠正句>}`，取终态 `values.polisher`。

**Rationale**: 三个前提全部现成——独立注册键（langgraph.json L11）、SubgraphState 已含 `raw_text` 输入通道、主链无 HITL。与 003 TTS 旁路、004 翻译旁路完全同构，前端新增一个 client 模块即可，符合原则 II/III。

**Alternatives considered**:
- 直调父图 talk_agent → 会在 HITL 挂死（003 实测教训），排除
- 新增后端润色旁路节点 → 无必要，polisher 本身就是现成的独立可调图，改动属过度设计，排除

## R2: 面板 AI 发音 = TTS 旁路懒加载，绝不经 polisher 直调合成

**Decision**: 两个面板的 AI 发音统一为「点击时懒加载」：
- 润色气泡面板：复用 005 的 `useTtsButton(messageId, "correct", rawText, polishAsCorrection, showHint)`——与 005 操作栏同句同键，缓存命中零合成
- 纠错气泡面板：直接调 `fetchTtsAudio(correctedSentence, [伪条目{wrong: correctedSentence, correct: 润色句, type: "polish"}])`，音频 Blob URL 存 **polisher-bypass-client 自有缓存**（键 `${messageId}:panel-polish`），不写 tts-client 全局缓存

**Rationale**: 若对 polisher 直调并传 `enable_tts: true` 给发音用，看似一次调用带回文本+音频，但**发音点击若晚于润色结果展示再单独直调会重跑 polisher_node 的 LLM**，产出与展示不一致的新润色句（005 R1 同款教训：直调 polisher 必漂移）。TTS 旁路（grammer_tutor 的 tts_request 分支）只合成不调 LLM，句子确定性成立。

**关键坑（缓存键冲突）**: tts-client 的 `getTtsAudioUrl` 会把 raw/correct 两段一起写入 `${messageId}:raw`/`${messageId}:correct` 全局键。纠错气泡本体的「示范句发音」已占用 `:correct` 键（音频=纠正句）；若面板用同一键传不同伪条目，会**覆盖纠正句音频**，导致气泡本体发音播错句。因此纠错面板必须绕过 getTtsAudioUrl，直接用导出的 `fetchTtsAudio` + 自有缓存键。润色面板无此冲突（气泡与面板同句，复用 useTtsButton 反而白拿缓存命中）。

**Alternatives considered**:
- 按需润色请求带 `enable_tts: true` 一次带回音频 → 单次调用内无漂移（音频即该次结果），但用户不点发音就白合成一次；且两条面板路径仍不统一，收益小，排除
- 面板音频写 tts-client 全局缓存 → 键冲突覆盖示范句音频（上述），排除

## R3: 按需润色结果缓存 = messageId 键的内存 Map（同 004 模式）

**Decision**: `polisher-bypass-client.ts` 内模块级 `Map<string, {polished_text, explanation}>`，键为消息 id；成功才写缓存，失败不缓存（允许重试，FR-006/007）。

**Rationale**: 与 translation-client 的 translationCache 同款；润色结果对同一输入是确定性请求语义（本期单风格），重复打开弹窗零请求满足 SC-003。纠错面板与润色面板数据来源不同（旁路 vs 消息透传），润色面板不需要此缓存（数据随消息常在）。

**Alternatives considered**: localStorage 持久化 → 会话级语义已满足 FR，持久化引入失效策略复杂度，排除。

## R4: 弹窗壳 = portal 到 body 的底部面板，状态由各气泡组件自持

**Decision**: `IdiomPanel` 用 `createPortal(document.body)` 渲染 fixed 底部面板 + 半透明遮罩；`idiomOpen` state 分别挂在 CorrectionBubble 与 PolisherBubble 内部，互不共享。

**Rationale**: 消息列表祖先链存在 overflow 裁剪风险，portal 一劳永逸；两气泡各自持有开合状态天然满足 Edge Case「切换会话面板随组件卸载关闭」（气泡组件 unmount → state 消失），也避免引入全局单例的跨消息互斥复杂度（同时开两个面板各自独立、遮罩各自全屏，实际用户操作下不构成问题）。

**Alternatives considered**: 全局 context 单例面板 → 跨组件接线成本高于收益，排除。

## R5: 003 ScoreBar 地道项 = 替换既有占位注释，受 hasGrammar 守卫

**Decision**: score-bar.tsx L50 的「地道项永不渲染」占位注释替换为真实入口按钮（`地道 / 优化表达 >`），渲染条件 `hasGrammar`（corrections 非空，与 FR-002 一致）；新增可选 prop `onIdiomOpen?: () => void`，未传时入口隐藏（向后兼容）。

**Rationale**: 003 R5 当年决议「永不渲染」的前提是「无数据源且无后续规划」，006 打开了入口但**分数仍无数据源**——所以入口不带分数（spec FR-002 拍板）。可选 prop 保证不改动时行为不变（零回归）。

## R6: 005 PolisherScoreBar 追加地道入口

**Decision**: 追加可选 prop `onIdiomOpen?: () => void`，恒显示 `地道 / 更多语境 >` 入口（润色气泡恒有润色结果，FR-001），不显示分数。

**Rationale**: 与 R5 同理；005 组件本身是静态无 props 组件，加可选 prop 是最小改动。

## R7: 风格标签栏 = 三项静态渲染，非默认项点击轻提示

**Decision**: 「地道美式」（active）/「商务正式」/「地道英式」三项按原型图渲染；后两项点击 `showHint("暂未开放")`，内容不变。

**Rationale**: 多风格需后端生成扩展（spec Assumptions 已拍板后置）；tab 样式先立住原型观感，切换行为给出明确预期而非假切换。
