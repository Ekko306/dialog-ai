# Implementation Plan: 语境润色弹窗（地道入口）

**Branch**: `006-idiom-panel` | **Date**: 2026-10-27 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/006-idiom-panel/spec.md`

## Summary

为纠错气泡（003）与润色气泡（005）的评分条增加「地道」入口，点击弹出底部面板，仅含「语境润色」单区块（优化后的句子 + 修改解释 + 风格标签栏 + 操作行四件套）。润色气泡数据即时复用 005 已透传的 `polisher_data`；纠错气泡以纠正句为输入，通过 `/runs/wait` 直调已独立注册的 `polisher` 子图按需生成（懒加载旁路，与 TTS/翻译旁路同构）。**本 feature 后端零改动**。

## Technical Context

**Language/Version**: TypeScript 5.x (Next.js App Router, assistant-ui langchain 模板) / Python 3.x (LangGraph, 仅只读核查)

**Primary Dependencies**: @assistant-ui/react、@assistant-ui/react-langchain、lucide-react、tailwindcss 4（既有脚手架栈，无新增依赖）

**Storage**: 无持久化；按需润色结果以内存 Map 会话级缓存（同 translation-client 模式）

**Testing**: pytest（后端既有回归，本 feature 不新增后端测试面）；前端无测试基建——验证走 oxlint + tsc + quickstart 人工验收（延续 005 T013 决议）

**Target Platform**: 桌面浏览器（localhost:3000），布局基准为原型图手机形态的语境润色区块

**Performance Goals**: 润色气泡入口点击到内容可见 ≤1s（本地数据）；纠错气泡按需生成 ≤10s（SC-002 ≥90%）

**Constraints**: 不写入对话线程；不阻塞气泡本体操作；003/004/005 既有行为零回归

**Scale/Scope**: 前端 2 个新文件 + 2 个评分条小改 + 2 个气泡组件接线，后端 0 改动

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 原则 | 结论 | 依据 |
|-----|------|------|
| I. assistant-ui 框架规范优先 | PASS | 弹窗为 assistant-ui 无内置原语的底部面板，延续 003/005 自定义气泡族风格与目录约定（components/ 下一 feature 一目录）；不替换任何框架运行时方案 |
| II. 前端适配后端，后端最小改动 | PASS（零改动） | `polisher` 子图已在 langgraph.json 独立注册（L11）；`SubgraphState` 已声明 `raw_text`/`enable_tts` 输入通道；主链 `START→polisher_node→tts_node→END` 无 HITL——直调条件全部现成，无需任何后端改动 |
| III. 现有数据结构复用，读取展示优先 | PASS | 复用 `PolisherOutput` 六字段契约、005 `parsePolisherData`/`polisherCache`、003 `CorrectionMessageData.corrections`、004 翻译旁路客户端模式；无新数据结构，仅前端视图层派生 |
| IV. 原型图驱动开发 | PASS | spec/plan/tasks 显式引用 `frontend/docs/mockups/子功能-对话演示气泡-单击发音或地道-弹出更多信息弹窗.jpg` 的语境润色区块；用户 2026-10-27 四张截图明确范围仅此区块（不入 docs，见 spec Assumptions） |

## Project Structure

### Documentation (this feature)

```text
frontend/specs/006-idiom-panel/
├── plan.md              # 本文件
├── research.md          # Phase 0 输出（R1~R7 决策）
├── data-model.md        # Phase 1 输出（弹窗数据与缓存实体）
├── contracts/
│   └── polisher-bypass-contract.md  # 按需润色旁路契约
├── quickstart.md        # Phase 1 输出（人工验收指南）
└── tasks.md             # /speckit-tasks 产出
```

### Source Code (repository root)

```text
frontend/
├── lib/
│   ├── tts-client.ts                    # [复用] TTS 旁路客户端（fetchTtsAudio 直接调用，不写其全局缓存）
│   ├── translation-client.ts            # [复用] 004 翻译旁路客户端（作为 polisher 旁路客户端的模板）
│   └── polisher-bypass-client.ts        # [新增] 按需润色旁路客户端 + 会话缓存 + 面板发音懒加载
├── components/
│   ├── idiom-panel/
│   │   └── idiom-panel.tsx              # [新增] IdiomPanel 弹窗壳（portal+遮罩+×）+ 语境润色区块 + 操作行
│   ├── correction-bubble/
│   │   ├── correction-bubble.tsx        # [修改] 挂 IdiomPanel + 传 onIdiomOpen 给 ScoreBar
│   │   └── score-bar.tsx                # [修改] 地道占位注释 → 真实入口（hasGrammar 时）
│   └── polisher-bubble/
│       ├── polisher-bubble.tsx          # [修改] 挂 IdiomPanel + PolisherScoreBar 接线
│       └── polisher-score-bar.tsx       # [修改] 追加地道入口（恒显示）
backend/                                  # 本 feature 零改动（仅只读核查记录于 research.md）
```

**Structure Decision**: 沿用 003/004/005 验证过的「lib 旁路客户端 + components 下一 feature 一目录」布局；弹窗组件独立目录（非塞进气泡目录），007 将在同一目录扩展发音区块。

## 后端零改动核查记录（原则 II 留档）

本 feature 经核查**不需要任何后端改动**，证据链：

1. **注册**：langgraph.json L11 `"polisher": "./src/talk_agent/subgraphs/polisher_subgraph/polisher_subgraph.py:polisher_subgraph"`——独立键已存在，`/runs/wait` 可直调（TTS/翻译旁路同款前提）
2. **输入契约**：SubgraphState（state.py L124-174）已声明 `raw_text`（polisher_node 读 `raw_text or user_input`）与 `enable_tts` 通道——直调输入 `{raw_text: <纠正句>}` 合法
3. **主链无阻塞**：polisher_subgraph.py 拓扑 `START→polisher_node→tts_node→END`，无 HITL——不存在 TTS 旁路当年「挂在 HITL」的死锁风险
4. **TTS 默认跳过**：tts_node L93-96 `enable_tts` 缺省 False 时 `tts_status="skipped"`、返回空音频——按需润色调用不触发无谓合成
5. **输出契约**：终态 values 含 `polisher` 六字段字典（PolisherOutput）——与 005 透传字段完全同名，前端解析器可直接复用

风险预案：若直调联调发现 polisher 子图对独立调用有隐式依赖（如缺 messages 通道报错），最小适配方案为在 plan.md 追加留档后修改（预期不需要，tasks 阶段有直验任务兜底）。

## Complexity Tracking

> 无宪法违规，本表留空。
