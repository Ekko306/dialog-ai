# Implementation Plan: 发音逐词分析信息弹窗（003-pronunciation-info-popup）

**Branch**: `003-pronunciation-info-popup`（实际工作分支：`zzl-pure`） | **Date**: 2026-10-27 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/003-pronunciation-info-popup/spec.md`
**原型图（需求与验收视觉基准）**: `frontend/docs/mockups/子功能-对话演示气泡-单击发音或地道-弹出更多信息弹窗.jpg`

## Summary

在对话气泡"发音/地道"入口上新增"发音逐词分析"弹窗（三大区块：逐词发音标注、评分建议、语境润色三风格）。前端经 `useLangChainState` 读取 LangGraph state 快照（`ise_check_results`/`ise_grade`/`ref_text`/`polisher`）做读取+展示与派生（五类标注阈值映射、进度条/仪表盘）；后端仅两处字段透出级最小适配：① `ise_analyze_node` 向 `ise_check_results` 透出已解析的四项评分与 `time_len` 推导的语速；② 润色链路按 Clarifications Q1 决策 A 一次性生成三风格（`PolishResult`/`SKILL.md`/`PolisherOutput` 扩展可选字段，图结构与节点逻辑零改动）。弹窗播放源（英音/美音/重读/AI 朗读）走新增 `POST /audio/tts` 按需合成（webapp.py 自定义路由 + `xfyun_tts_tool_by_text` 加可选 vcn 参数）；"我的"回放复用前端最近一轮录音 PCM，后端零改动。

## Technical Context

**Language/Version**: 前端 TypeScript（Next.js 16 + React 19）；后端 Python 3.13（LangGraph dev）

**Primary Dependencies**: 前端 `@assistant-ui/react` + `@assistant-ui/react-langchain`（useLangChainState）+ `@base-ui/react`（Dialog）+ Tailwind 4 + lucide-react；后端 LangGraph、LangChain（DeepSeek structured output）、讯飞 SDK（IAT/ISE/TTS）、FastAPI（webapp.py 自定义路由）

**Storage**: N/A（无持久化；收藏为会话内存态，录音为前端内存槽）

**Testing**: 前端 `pnpm lint`（oxlint/oxfmt）+ `pnpm build` + 浏览器实测；后端直接运行既有冒烟脚本（`polisher_test.py`、`ise_analyze_node` 自测）+ `uv run langgraph dev` 端到端联调

**Target Platform**: 桌面/移动浏览器（Next dev，localhost 或局域网 https）

**Project Type**: web 前后端分离（frontend/ + backend/，monorepo 双端结构）

**Performance Goals**: 弹窗打开 1 秒内完整呈现（SC-001）；播放源点击 2 秒内出声（SC-003）；Tab 切换即时（SC-005）

**Constraints**: 后端仅允许字段透出/格式适配级最小改动（FR-016，Constitution 原则 II）；缺失数据一律空态/置灰不虚构（FR-015）；后端启动必须 `PYTHONUTF8=1` + `--no-reload`；改动仅推送 `zzl-pure` 分支

**Scale/Scope**: 单弹窗组件 + 播放 hook + 少量派生常量；后端 4 文件小改（ise_analyze_node / polisher_schema / SKILL.md / polisher_service+state）+ 2 处透传适配（webapp.py / xfyun_tts_tool）

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 原则 | 结论 | 依据 |
|---|---|---|
| I. assistant-ui 框架规范优先 | ✅ PASS | 数据读取用框架官方 LangChain 适配 hooks（`useLangChainState`，hooks.d.ts:83）；弹窗复用 Base UI Dialog + Portal 既有模式（scene-select-popup.tsx 先例）；气泡入口挂在 `UserMessage`（MessagePrimitive 体系内），不绕开框架自建消息流 |
| II. 前端适配后端，后端最小改动 | ✅ PASS | 后端改动清单全部为"字段透出/格式适配"：① `ise_check_results` 追加已解析的 `scores` + `speed_wpm`（parse_ise_xml 既有产物，无新计算逻辑）；② 润色 schema/提示词扩展（Q1 决策 A 已裁决，用户确认）；③ `POST /audio/tts` 新路由复用 webapp.py 既有模式、`xfyun_tts_tool_by_text` 加可选 vcn 参数（默认行为不变）。图结构、节点判定逻辑、状态流转零改动。**polisher_node 字段透传留档（原则 II 要求）**：Q1 决策 A 的三风格数据要经 `polisher_node` 写入 state，而该节点现按字段名显式挑选结果键，故成功分支必须新增 `result.get("style_business"/"style_british")` 两行透传（外加初始化 dict 补默认 None）——这是数据管道的必要最小改动，无任何分支/判定/日志逻辑变化；analyze I1 已裁决并经用户确认（2026-10-27） |
| III. 现有数据结构复用，读取展示优先 | ✅ PASS | 弹窗全部数据来自既有 OverAllState key（仅增字段不改结构）；三档标注/语速指针/建议切分/收藏态等派生逻辑均在前端视图层；无新数据结构引入（PolisherOutput 仅追加可选字段，续杯契约不变） |
| IV. 原型图驱动开发 | ✅ PASS | 本 plan/spec/data-model/contracts 均引用原型图路径；quickstart.md S6 为目视比对步骤；tasks 阶段须继续引用原型图 |

**Post-Phase 1 复核**: 设计未引入新依赖、未新增持久化、未改动 Agent 核心逻辑 → 四原则维持 PASS，无 Complexity Tracking 项。

## Project Structure

### Documentation (this feature)

```text
frontend/specs/003-pronunciation-info-popup/
├── plan.md              # 本文件（/speckit-plan 输出）
├── research.md          # Phase 0：R1~R8 研究决策（含 Constitution II 留档）
├── data-model.md        # Phase 1：state 契约 + 前端视图模型
├── contracts/
│   ├── state-data.md    # 弹窗消费的 state 数据契约（前端 ← LangGraph values）
│   └── audio-tts.md     # POST /audio/tts 契约（前端 → webapp.py 自定义路由）
├── quickstart.md        # 端到端验证清单（S1~S6）
└── tasks.md             # Phase 2 输出（/speckit-tasks 生成，本阶段不创建）
```

### Source Code (repository root)

```text
backend/                                          # 最小适配（Constitution II 边界内）
├── langgraph.json                                # 不改（http.app 已挂 webapp.py）
└── src/
    ├── webapp.py                                 # ★新增 POST /audio/tts 路由（口音映射常量）
    ├── llm_models/
    │   ├── prompts/skills/english_expression_polisher/
    │   │   ├── polisher_schema.py                # ★StylePolish + PolishResult 两可选风格字段
    │   │   └── SKILL.md                          # ★Section 6 追加三风格输出要求
    │   └── get_model.py                          # ★get_polisher_model system prompt 追加三风格要求
    ├── tools/audio_tool/xfyun_tts/
    │   └── xfyun_tts_tool.py                     # ★xfyun_tts_tool_by_text 加可选 vcn 参数（默认不变）
    └── talk_agent/
        ├── state.py                              # ★PolisherOutput 追加 style_business/style_british
        ├── subgraphs/grammar_check_subgraph/
        │   └── ise_analyze_node.py               # ★ise_check_results 透出 scores + speed_wpm
        └── subgraphs/polisher_subgraph/
            ├── polisher_service.py               # ★三规则校验抽函数按风格复用，失败风格置 None
            └── polisher_nodes.py                 # ★polisher_node 仅透传 style 两字段（必要管道，见 Constitution Check II 留档）
            # polisher_subgraph.py 图结构不改；polisher_node 禁止改分支/判定/日志逻辑

frontend/
├── app/
│   └── assistant.tsx                             # 不改（runtime 已就绪）
├── components/
│   ├── thread.aui.tsx                            # ★UserMessage 增加"发音/地道"入口（US1）
│   ├── server-dictation-adapter.ts               # ★成功路径暂存最近一轮录音 PCM（R4 内存槽）
│   ├── pronunciation-popup/                      # ★新功能目录（本功能主体，全部新增）
│   │   ├── pronunciation-popup.tsx               # 弹窗容器（Dialog 三区块布局，对照原型图；打开时冻结 state 快照）
│   │   ├── word-analysis-section.tsx             # 逐词着色 + 图例 + 三播放源 + ↻重读
│   │   ├── score-section.tsx                     # 综合徽章 + 三进度条 + 语速仪表盘 + 建议
│   │   ├── polish-section.tsx                    # 三风格 Tab + 四工具 + AI 生成标注
│   │   ├── word-marks.ts                         # 逐词标注派生（阈值/关键词，可调常量）
│   │   ├── use-popup-audio.ts                    # 单例播放器（/audio/tts + 录音回放 + loop）
│   │   └── popup-store.ts                        # 收藏内存态 + 弹窗 UI 态（关闭复位）
└── specs/003-pronunciation-info-popup/           # 本功能设计产物（见上）
```

**Structure Decision**: 沿用 monorepo 既有 `frontend/` + `backend/` 双端结构。前端新增 `components/pronunciation-popup/` 独立目录承载弹窗全部组件与派生逻辑（与 scene-select/ 同构）；后端改动全部落在既有文件内（无新包/新模块），保持最小适配边界可审查。

## Complexity Tracking

> Constitution Check 四原则全部 PASS，无违规项，本表留空。

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| N/A | N/A | N/A |
