# Research: 循环跟读录音评测（008）

> 逐项决策均带代码证据；本 feature 为前端装配层，所有决策围绕「复用 007、隔离 007、零后端改动」。

## R1 评测链路：复用 `/audio/evaluate`，但 **不复用 evaluationCache**

**Decision**: 调 007 的 `fetchEvaluation(pcm, refText)`（`lib/evaluation-client.ts`），评测结果存组件本地 state；**不读写** `evaluationCache` / `recordingStore`。

**Rationale**: 007 缓存键语义 = 「消息级最新评测」且被发音逐词分析面板消费（`idiom-panel.tsx` 打开即读 `evaluationCache.get(messageId)`）；若 008 跟读评测写入同键，用户跟读后打开纠错气泡「发音」会看到跟读轮的结果——违反 008 spec FR-008「仅面板内展示」与 007 的消息级语义。008 spec 明确「面板会话内有效，关闭即失效」→ 组件本地 state 天然满足。

**Alternatives considered**: 复用 evaluationCache（key 加后缀隔离）——被否：仍需处理「idiom 面板误读」防御逻辑，本地 state 更简单且生命周期天然正确。

## R2 录音操作区：直接复用 007 `RerecordBox`

**Decision**: 麦克风点击 → 面板内渲染 `components/idiom-panel/rerecord-box.tsx`（props: `refText=跟读文本, onRecorded(pcm), onCancel`）。

**Rationale**: RerecordBox 已实现 008 spec 全部 Edge Case——权限拒绝提示、<300ms 过短提示、开始/结束/取消、录制中反馈与计时、卸载释放麦克风；行为与 007 重读完全一致（用户原话「和发音逐词分析的重读功能是一样的流程」）。零新增代码。

**Alternatives considered**: 面板内自写录音区——被否：重复实现且行为漂移风险。

## R3 「我的」回放：PCM→WAV 纯前端封装 + audio-manager 播放

**Decision**: 新增 `lib/pcm-wav.ts`（Int16 PCM + 16kHz 参数 → WAV Blob → `URL.createObjectURL`），用全局 audio-manager `play(sourceId, url)` 播放，sourceId = `` `${messageId}:follow-mine` ``。

**Rationale**: audio-manager 提供全局互斥（FR-005 既有约束：示范播放/「我的」/气泡发音不叠音）；WAV 封装是 44 字节头 + 原始 PCM 直写，纯前端零依赖。浏览器原生可播 16kHz 16bit mono WAV。

**Alternatives considered**: 面板内游离 `new Audio()`——被否：绕过互斥，可能与示范播放叠音（003 audio-manager 立项原因）。loop 状态跟随全局开关（用户可关），记录为已知行为。

## R4 评分视图装配：逐词着色句 + ScoreAdviceSection 原样复用

**Decision**: 新增 `follow-along-scoring.tsx` 装配组件：
- 逐词着色句：复用 `pronunciation-section.tsx` 的着色规则（≥85 绿/70~85 黄/<70 红/null 不着色 + flags 角标），词间距 `mr-2`（2026-10-28 已修的 inline-block 空白折叠坑不重蹈）；**不渲染** PronunciationSection 的「美音」按钮与图例行——图二句行无此元素，示范播放由面板既有中央播放键承担（`:correct` TTS 已缓存）
- 评分建议：`ScoreAdviceSection(result, onRerecord)` 原样复用（徽章 + 三行分数条 + 虚线 + 档位评语 + 标题行重读入口）
- 「我的」按钮：加在面板既有控制排（图二为播放行右侧圆钮），无录音时禁用

**Rationale**: 视觉与 007 评分区块完全一致（spec SC-002）；着色 helper 若跨组件复用需从 pronunciation-section 导出——`wordToneClass` 导出复用，不复制粘贴。

**Alternatives considered**: 面板内嵌 PronunciationSection 整块——被否：带「美音」按钮与图例，与图二布局不符。

## R5 语速仪表盘：v1 不实现（spec Assumption 落地）

**Decision**: 不做图二右侧语速仪表盘；ScoreAdviceSection 的分数条 + 文字建议即评分界面全貌。

**Rationale**: 语速数据在讯飞 ISE XML 的 fluency/time 类字段中，`parse_ise_xml` 未透出；提取需改后端（违反 FR-011）。已在 spec Assumptions 显式记录，非需求遗漏。

## R6 录音与示范互斥 + 面板关闭清理

**Decision**:
- 录音开始（RerecordBox 挂载前）：若示范播放中 → `audio.pause()`（FR-009：暂停不停止，不自动恢复）
- 面板关闭（`openMessageId` 变 null）：本地评测会话整体重置（phase=idle、pcm/result 清空）；若录音进行中由 RerecordBox 卸载 effect 兜底 cancel 释放麦克风（007 已有）
- 面板重开：从干净 idle 态开始（spec US2 验收 3）

**Rationale**: zustand store 只持面板开合与文本，不持评测会话——会话放组件本地 state，关闭即随组件销毁（Dialog unmount），清理零成本且无遗漏路径。

**Alternatives considered**: 会话入 zustand——被否：需要显式清理钩子，徒增状态同步。

## R7 麦克风区文案与模式

**Decision**: 占位文案「按住说话，开始跟读」改为「点击麦克风，开始跟读」；提示行复用面板既有 hint 机制。

**Rationale**: 交互为点击开始/点击结束（与 007 重读一致，用户已确认同流程），原「按住说话」文案与新交互矛盾（图一原文案是旧占位）。
