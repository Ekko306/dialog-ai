# Research: 发音逐词分析面板

**Feature**: 007-pronunciation-analysis | **Created**: 2026-10-27

## R1 数据源：主链聊天 run 不含音频（颠覆 spec 初始前提）

**Decision**: 首评与重读统一走懒评测旁路；录音 PCM 前端会话内暂存，面板打开时按需评测。

**Rationale**（代码证据）：
- [server-dictation-adapter.ts](file:///d:/langgraphprodaima/dialog-ai/frontend/components/server-dictation-adapter.ts) L212：语音输入 = PCM POST `/api/audio/transcribe` → 仅 `text` 回填 composer → 用户发送**文本消息**
- 聊天 run 的 input 无音频字段 → 主链 `audio_data` 恒空 → grammar_check 内 ISE 短路 `no_audio` → `ise_xml_info=""`、`ise_grade=None`、`ise_check_results` 降级
- 结论：spec 初始前提「逐词数据 = 本轮已有评测结果，打开即显示」不成立——本轮根本没有评测发生过
- `ise_check_results`/`ise_xml_info`/`ise_grade` 虽在 OverAllState 且可经 useLangChainState 读取（[state.py](file:///d:/langgraphprodaima/dialog-ai/backend/src/talk_agent/state.py#L53-L55)），但当前值恒为 no_audio 降级态，US1 不可依赖

**Alternatives considered**：
- B) 聊天 run input 附带音频 → 后端主链跑 ISE：波及主链行为与输入契约，风险高、违背最小改动
- C)（采纳）录音 PCM 前端暂存 + 懒评测：零主链改动；PCM 按转写文本关联（发送的文本=转写文本），气泡以 data.raw_text 查 PCM；历史消息/刷新后 PCM 失效 → 天然落入 FR-007 降级
- spec 微调：US1/SC-001 由「打开即显示」改为「打开即发起评测（1~2s 加载反馈）后填充」；FR-003 数据源改为按需评测结果

## R2 重读评测旁路形态：webapp.py 端点（非 grammer_tutor 分支）

**Decision**: `POST /audio/evaluate`（octet-stream PCM + ref_text）→ `xfyun_ise_tool_by_audio_data` → `parse_ise_xml(xml, max_score=5.0)` → JSON。

**Rationale**：
- [webapp.py](file:///d:/langgraphprodaima/dialog-ai/backend/src/webapp.py) 已有 `/audio/transcribe` 同构先例（octet-stream body、长度下限、anyio 线程池、统一错误形态），复制该形态风险最小
- 两个核心函数现成且被单测覆盖：`xfyun_ise_tool_by_audio_data`（[xfyun_ise_tool.py](file:///d:/langgraphprodaima/dialog-ai/backend/src/tools/audio_tool/xfyun_ise/xfyun_ise_tool.py) L38 `aue="raw"` 吃裸 PCM）+ `parse_ise_xml`（[ise_analyze_node.py](file:///d:/langgraphprodaima/dialog-ai/backend/src/talk_agent/subgraphs/grammar_check_subgraph/ise_analyze_node.py#L80-L123)，输出 total/accuracy/fluency/integrity/is_rejected/words）
- Alternatives：grammer_tutor 加 `ise_request` 分支——需 bytes 序列化进 /runs/wait JSON、绕 HITL 主链（tts_request 同款坑）、无额外收益；否决
- **后端改动预算**：webapp.py +1 端点（约 30 行），零 graph/节点/契约改动（plan 已留档）

## R3 录音格式：webm/opus 风险不存在，复用裸 PCM 采集

**Decision**: 重读录音复用 dictation adapter 同款采集链（getUserMedia → AudioContext 16k → AudioWorklet/ScriptProcessor → Int16 PCM）。

**Rationale**：
- 「按住说话」探查时的 webm/opus 风险基于 MediaRecorder 假设；实际项目语音输入从未用 MediaRecorder——adapter 直接采裸 PCM（transcribe 契约 L22）
- ISE `aue="raw"` 要求裸 PCM ✓ 与采集输出天然匹配，**无需任何转码**
- 实现形态：将 adapter 的采集段抽为可复用工具（`lib/pcm-recorder.ts`：start/stop/cancel + Int16 结果回调），adapter 改为内部使用之（行为不变，回归由 003~006 复测覆盖）；重读录音区直接使用该工具

## R4 词对齐：逐词分析展示原句（ISE 实际评测对象）

**Decision**: 逐词视图以 `/audio/evaluate` 返回的 `words` 为准（= 用户原句词序）；美音示范播原句；纠正句只进 006 语境润色区。

**Rationale**：
- ISE 参考文本 = ref_text = 转写文本（用户原句）；XML `word/@content` 即原句分词 → 词数天然一致，无需对齐算法
- spec FR-002 原写「纠正句的逐词视图」与数据事实矛盾（评测的是原句）→ 已修正为「本轮被评测句（用户原句）」
- 美音示范 = 003 raw kind TTS（原句美音）复用缓存键 `${messageId}:raw`，与纠错气泡工具栏「发音」按钮同键命中，零新增合成
- 逐词渲染规则：score 分级着色（百分制：≥85 优/绿、70~85 中/黄、<70 弱/红，None 不着色）；flags（漏读/增读/替换/音素异常）以角标或说明展示；缺失词不伪造（FR-008）

## R5 分数与点评双源合流

**Decision**: 四项分数 + 逐词分以评测端点确定性解析为准；中文逐词点评（`ise_check_results.pronunciation`）与整体建议（`advice`）作为增强层叠加。

**Rationale**：
- 端点输出（parse_ise_xml）纯确定性，无 LLM 依赖 → 分数区块永远可渲染
- `ise_check_results` 来自本轮聊天 state（useLangChainState）——但本轮 ISE 未跑（R1），该字段实际是降级态 → **本期点评层预计常缺**；设计为「有则叠加、无则不显示」，不做硬依赖
- 评分建议文案（面板内）= `advice` 缺失时显示四项分数 + 简短确定性提示（如各项分数档位说明），不伪造文案

## R6 重读生命周期与缓存边界

**Decision**: 评测缓存 `Map<messageId, EvaluationResult>`（会话内存）；重读结果覆盖写；PCM 暂存 `Map<rawText, ArrayBuffer>`，发送后即关联、刷新即清。

**Rationale**：
- 不回写气泡评分条（spec FR-005 硬约束）：重读结果仅注入面板 props，ScoreBar 仍读 correction_data.ise_grade
- 不进对话线程：无任何 LangGraph 状态写入，天然满足
- PCM 暂存时机：dictation stop() 成功后存 `Map<transcript, PCM>`；面板打开按 raw_text 查（includes 匹配降级为精确匹配，005 同款问题文本改写场景查不到 → 降级提示「未找到本次录音」）
- 会话内存边界（刷新失效）已记入 spec Edge Cases，与 003/005 缓存策略一致
