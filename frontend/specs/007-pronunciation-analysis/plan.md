# Implementation Plan: 发音逐词分析面板（纠错气泡发音/地道入口）

**Branch**: `007-pronunciation-analysis`
**Spec**: [spec.md](./spec.md)
**Created**: 2026-10-27

## Technical Context

**Language/Version**: TypeScript 5.x（Next.js 15 App Router + assistant-ui）+ Python 3.12（LangGraph 0.6/langgraph-api 0.10.3）
**Primary Dependencies**: @assistant-ui/react(-langchain)、@langchain/langgraph-sdk、lucide-react、fastapi（webapp.py）、xfunsdkspeech ISE SDK
**Storage**: 前端内存（Map 缓存，无持久化）；后端无新增存储
**Testing**: pytest（后端，uv run pytest）、oxlint + tsc（前端）；人工验收 per quickstart
**Target Platform**: 桌面浏览器（localhost:3000 ↔ 127.0.0.1:2024）

## Constitution Check

| 原则 | 状态 | 依据 |
|---|---|---|
| I assistant-ui 规范优先 | PASS | 面板为 006 IdiomPanel 的扩展区块；录音采集实现 assistant-ui DictationAdapter 同款采集语义（getUserMedia + AudioWorklet PCM） |
| II 前端适配后端，后端最小改动须 plan 留档 | PASS（留档见下节） | 后端唯一改动 = webapp.py 新增 1 个评测端点（约 30 行，与 transcribe 同构，纯函数复用，零图/节点改动）；前端适配既有产物（PCM 采集器、ISE 工具、parse_ise_xml） |
| III 现有数据结构复用 | PASS | 复用 parse_ise_xml 输出结构、CorrectionItem/TTS 缓存键、IdiomPanel、dictation adapter 采集逻辑；不发明新契约形态 |
| IV 原型图驱动开发 | PASS | 布局基准 mockup 弹窗 + 用户 2026-10-27 拍板调整（美音单路、重读录音）已固化 spec |

**GATE**: 全 PASS，无违反。

## 后端最小适配说明（Constitution II 留档，用户已知悉边界）

**改动点（唯一）**：[webapp.py](file:///d:/langgraphprodaima/dialog-ai/backend/src/webapp.py) 新增 `POST /audio/evaluate` 端点：
- 输入：octet-stream 裸 PCM（16kHz/16bit/单声道，与 transcribe 同格式）+ `ref_text` 查询参数（被评测句）
- 处理：`xfyun_ise_tool_by_audio_data(audio, ref_text)` → `parse_ise_xml(xml, max_score=5.0)`（两个现成纯函数）
- 输出：`{total, accuracy, fluency, integrity, is_rejected, words: [{word, score, flags}]}` 或统一错误形态（同 transcribe 契约风格）
- 长度下限沿用 `_MIN_AUDIO_BYTES`；同步 SDK 放 anyio 线程池（同 transcribe）

**不碰的部分**：所有 graph/子图/节点/langgraph.json/全局 state 契约。理由：主链聊天 run 无音频（R1），ISE 评测天然是旁路职责，与 TTS/翻译/润色旁路同构；webapp.py 已是该形态先例（001 转写端点）。

**风险评估**：接近零——端点无状态、复用已测试的纯函数、不进图运行时、不影响任何既有请求路径。

## 关键技术决策摘要（research 详见 research.md）

- **R1 数据源颠覆性事实**：前端语音输入 = dictation adapter → `POST /audio/transcribe` 独立转写 → 仅文本进聊天 run → **主链 state.audio_data 恒空、ISE 从不在聊天轮内执行**（`ise_status=no_audio`）。首轮评测也必须走懒评测：录音 PCM 前端会话内暂存（按转写文本关联），面板打开时按需评测。spec 相应微调（US1 加载态、SC-001 措辞、Assumptions 补充）
- **R2 旁路形态**：webapp.py 端点（上节）优于 grammer_tutor 加 ise_request 分支——后者需 bytes 进 /runs/wait JSON + 绕 HITL 主链，复杂度高且无收益
- **R3 音频格式**：webm/opus 风险不存在——[server-dictation-adapter.ts](file:///d:/langgraphprodaima/dialog-ai/frontend/components/server-dictation-adapter.ts) 已实现 16kHz Int16 裸 PCM 采集（AudioWorklet/ScriptProcessor 回退），重读录音复用同款采集逻辑（抽公共工具，adapter 与重读共用）
- **R4 词对齐**：ISE 评测对象 = 用户原句（XML word content 即原句词序）→ 逐词分析展示**原句词**（非纠正句）；美音示范播原句（复用 003 raw kind TTS 缓存键 `${messageId}:raw`）；纠正句仅进入 006 语境润色区。spec FR-002 相应修正
- **R5 分数与点评双源**：四项分数 + 逐词分以 `/audio/evaluate` 确定性解析为准（parse_ise_xml 已单测）；中文点评叠加 ise_check_results.pronunciation（LLM 点评，本轮 state 可读则有，无则不显示不阻塞）——即使 DEEPSEEK 未配置点评缺失，分数区块仍完整可用
- **R6 重读生命周期**：新录音评测结果写前端 evaluationCache（messageId 键）覆盖旧值，仅面板消费；不回写气泡评分条（spec FR-005）、不进对话线程；PCM 暂存与评测缓存均为会话内存，刷新即清（Edge Case 覆盖）

## Phase 划分

- **Phase A（US1）**：`/audio/evaluate` 端点 → 前端 PCM 暂存与评测客户端 → IdiomPanel 扩展发音逐词分析 + 评分建议区块（纠错气泡两入口升级为完整面板）→ 降级路径
- **Phase B（US2）**：重读录音区组件（复用 PCM 采集）→ 评测刷新状态机 → 权限/过短录音 Edge Case
- **Phase C（US3）**：文本输入降级 + 003~006 全量回归
