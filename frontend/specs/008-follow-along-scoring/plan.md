# Implementation Plan: 循环跟读录音评测（开始跟读 → 综合评分）

**Branch**: `008-follow-along-scoring` | **Date**: 2026-10-28 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/008-follow-along-scoring/spec.md`

## Summary

循环跟读面板（`components/follow-along-panel/follow-along-panel.tsx`）三项改造：
1) 示范播放标签栏仅保留英语(美)（US3）；2) 麦克风占位升级为真实录音评测闭环——点击麦克风 → 面板内录音 → 结束后按需评测（复用 007 `POST /audio/evaluate`）→ 面板内展示综合评分界面（逐词着色原句 + 评分徽章 + 三行分数条 + 虚线 + 文字建议），支持重读再评与「我的」录音回放（US1/US2）。
**后端零改动**：评测端点、PCM 采集、评分展示全部复用 007 已交付能力，本 feature 纯前端装配。

## Technical Context

**Language/Version**: TypeScript 5.x（Next.js 15 App Router，strict）

**Primary Dependencies**: @base-ui/react（Dialog）、zustand（面板跨组件状态）、lucide-react、全局 audio-manager（互斥播放）、007 复用件：`lib/pcm-recorder.ts` / `lib/evaluation-client.ts`（fetchEvaluation + EvaluationResult 类型）/ `components/idiom-panel/pronunciation-section.tsx`（ScoreAdviceSection、逐词着色规则）/ `components/idiom-panel/rerecord-box.tsx`（录音操作区）

**Storage**: 无持久化——评测会话（用户录音 PCM + 评测结果）为组件本地 state，面板关闭即销毁（spec FR-008）

**Testing**: 无新增自动化测试（与 003~007 一致）；验证 = oxlint + tsc 零新增 + quickstart 人工验收 + 既有 pytest 基线不破

**Target Platform**: 桌面/移动浏览器（录音需安全上下文 https:// 或 localhost）

**Performance Goals**: 结束录音 → 评分展示 ≤ 3s（评测请求 1~2s + 渲染，spec SC-001）

**Constraints**: 后端零改动（spec FR-011）；不回写对话线程/气泡（FR-008）；语速仪表盘 v1 不做（spec Assumption，无数据源）

**Scale/Scope**: 单组件改造 + 1 个新展示组件 + 1 个 PCM→WAV 小工具；约 3 文件新增/修改

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 原则 | 结论 | 依据 |
|---|---|---|
| I. assistant-ui 框架规范优先 | PASS | 宿主面板沿用既有 @base-ui/react Dialog + zustand 模式（002/003 已验证），不另起炉灶；录音操作区直接复用 007 RerecordBox 组件 |
| II. 前端适配后端，后端最小改动 | PASS | **后端零改动**（用户硬约束 + spec FR-011）：评测走 007 已有 `POST /audio/evaluate`，无任何后端文件触碰 |
| III. 现有数据结构复用 | PASS | 评测结果结构 = 007 EvaluationResult 原样复用；录音采集 = 007 pcm-recorder；评分展示 = 007 ScoreAdviceSection；不新增字段、不改 007 缓存 |
| IV. 原型图驱动开发 | PASS | 视觉基准 = 用户会话截图（2026-10-28，用户明确不入库），spec「视觉基准」节已文字留档；验收时与截图目视比对 |

**Phase 1 复查**：设计未引入新数据结构、未触碰后端、未偏离复用路线——四原则维持 PASS。

## Project Structure

### Documentation (this feature)

```text
specs/008-follow-along-scoring/
├── plan.md              # 本文件
├── research.md          # Phase 0：R1~R6 决策
├── data-model.md        # Phase 1：评测会话状态机 + WAV 封装格式
├── quickstart.md        # Phase 1：人工验收指南
├── contracts/
│   └── follow-along-scoring.md  # 组件装配契约（复用边界 + 缓存隔离红线）
└── tasks.md             # /speckit-tasks 产出
```

### Source Code (repository root)

```text
frontend/
├── components/
│   ├── follow-along-panel/
│   │   └── follow-along-panel.tsx        # 宿主改造：标签单项化 + 录音评测状态机 + 评分装配
│   └── follow-along-panel/
│       └── follow-along-scoring.tsx      # 新增：评分视图（逐词着色句 + ScoreAdviceSection 装配 + 我的回放行）
└── lib/
    ├── pcm-wav.ts                        # 新增：Int16 PCM → WAV Blob URL（「我的」回放，纯前端）
    ├── pcm-recorder.ts                   # 复用（007，零改动）
    └── evaluation-client.ts              # 复用（007，零改动；缓存不接入 008）

backend/                                  # 本 feature 零改动
```

**Structure Decision**: 全部改动收敛在 `frontend/components/follow-along-panel/` 与 `frontend/lib/`，复用件零触碰；与 007 的隔离红线（evaluationCache/recordingStore 不接入）见 contracts。

## Complexity Tracking

> 无宪法违规项，表留空。
