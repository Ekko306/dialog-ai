# Implementation Plan: 精品课（精讲课对话）

**Branch**: `005-premium-course` | **Date**: 2026-11-06 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `frontend/specs/005-premium-course/spec.md`

**设计基准**: `backend/src/talk_agent/documents/grammar_check_subgraph/ai-course-langgraph-design.md`（v1.1，已剥离 ASR/发音评测，跟读改打字比对）

## Summary

把 001 中"精讲课对话"占位 Tab 落地为完整的精品课功能，前后端同步实现：

1. **前端**：Tab2 从 `EmptyTab` 换成精品课页面，三级结构——课程列表（按分类分组）→ 课程详情（章节 + 课时 + 完成状态）→ 课时学习页（独立全屏引导流程，按五个环节推进）。
2. **后端**：新建课时 LangGraph（`LessonState` + 设计稿节点），外部通过 `webapp.py` 暴露精简 HTTP 接口（开始课时 / 推进一步），把每次 `interrupt()` 的内容作为响应返回前端，把用户输入作为 `Command(resume=...)` 续跑。前端无需理解图结构，只按 `stage` 渲染。
3. **数据**：课程内容预置在 JSON 文件（单课程 2~3 章、每章 1 课时）；学习进度落在后端本机 JSON 文件，前端只读。

## Technical Context

**Language/Version**: TypeScript 5.x（strict）+ Python 3.12（后端项目 venv）

**Primary Dependencies**:
- 前端：Next.js 16.3.5（App Router / turbopack）、React 19.3、Tailwind CSS 4.3、zustand 5、lucide-react、@base-ui/react
- 后端：LangGraph（`langgraph dev` / checkpoint）、FastAPI（`langgraph.json` → `http.app` → `src/webapp.py`）、DeepSeek（`with_structured_output`）、讯飞 TTS（已有 `xfyun_tts_tool_by_text`）

**Storage**:
- 课程目录：`backend/src/course_agent/data/courses.json`（只读预置）
- 学习进度：`backend/src/course_agent/data/progress.json`（后端本机读写，单用户）
- 图运行态：`InMemorySaver`（dev）；续学位置由 progress.json 承载，不依赖持久化 checkpointer

**Testing**:
- 后端：pytest 单测覆盖纯函数（比对归一化、路由条件、课程/进度读写），不依赖 API key
- 前端：vitest 覆盖归一化比对、store 状态机、（可选）页面渲染
- 端到端：以 [quickstart.md](./quickstart.md) 手工验证为准

**Target Platform**: 移动浏览器竖屏 + 桌面浏览器（localhost）

**Project Type**: Web 应用（monorepo：`frontend/` + `backend/`）

**Performance Goals**: 课程列表加载 ≤1s（本机 JSON）；单次 AI 环节响应 ≤8s（受 DeepSeek 支配）；环节间切换即时

**Constraints**:
- 沿用 001 的四项 Constitution 原则：assistant-ui 官方规范优先、前端适配后端且最小后端修改、现有数据结构复用、原型图驱动（本期无原型图，视觉沿用现有绿色主题体系）
- 不新增底部 Tab，不引入登录/多用户
- 课程内容不由 LLM 生成；AI 只负责评价、反馈、角色扮演、优化、总结
- 流程推进完全由图的路由代码控制，AI 不得决定下一个环节（设计稿红线）

**Scale/Scope**: 单用户本机；1 门课程 / 2~3 章节 / 每章 1 课时；前端约 10 个新增文件 + 2 处修改，后端约 8 个新增文件 + 2 处修改

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 原则 | 结论 | 依据 |
|------|------|------|
| I. assistant-ui 官方规范优先 | ✅ PASS | 精品课是独立引导式页面，不复用对话消息流，因此不触碰 assistant-ui 原语；仅沿用现有视觉组件（`tooltip-icon-button`、主题变量）。 |
| II. 前端适配后端，最小后端修改 | ✅ PASS | 后端改动集中在 `src/course_agent/`（新图 + 数据 + 进度）与 `webapp.py` 追加 4 个路由；`talk_agent` 主图、现有 `/audio/*` 端点零改动。 |
| III. 现有数据结构复用，读取展示优先 | ✅ PASS | 复用现有 LangGraph 概念（`interrupt` / `Command(resume)` / `with_structured_output`）；新增数据仅为课程与进度，不修改对话相关 state。 |
| IV. 原型图驱动开发 | ✅ PASS（无原型图，改用既有视觉体系） | 本期无课程原型图（spec Clarifications 已确认），视觉延续 001 的绿色主题、大圆角、竖屏布局；plan 的 UI 结构在 data-model / quickstart 中固化。 |

**Phase 1 复检**: 4 项维持 PASS。后端新增全部为独立目录与独立路由，无跨模块侵入；前端只在 `main-tab-shell.tsx` 替换 Tab2 分支。Complexity Tracking 留空。

## Project Structure

### Documentation (this feature)

```text
frontend/specs/005-premium-course/
├── spec.md                  # 已完成
├── plan.md                  # 本文件
├── research.md              # Phase 0：技术决策
├── data-model.md            # Phase 1：课程/进度实体与状态机
├── contracts/
│   ├── course-catalog.md    # GET 课程目录（含进度）
│   └── lesson-session.md    # POST 开始课时 / 推进一步
├── quickstart.md            # 手动验证指南
├── checklists/requirements.md
└── tasks.md                 # Phase 2（/speckit-tasks 生成）
```

### Source Code (repository root)

```text
backend/
├── src/
│   ├── course_agent/
│   │   ├── course_graph.py              # 【替换】模板空图 → 改为 re-export lesson_graph 的 graph（保持 langgraph.json 注册路径有效）
│   │   ├── lesson_graph.py              # 【新增】课时主图：LessonState + 节点 + 条件边
│   │   ├── lesson_state.py              # 【新增】LessonState / Exercise / Evaluation 等 TypedDict
│   │   ├── course_repository.py         # 【新增】读 courses.json；课程/章节/课时查询
│   │   ├── progress_repository.py       # 【新增】progress.json 读写（原子写 + 幂等）
│   │   ├── text_match.py                # 【新增】跟读归一化比对（纯函数，可单测）
│   │   ├── agents.py                    # 【新增】AnswerEvaluator / FeedbackGenerator / RoleplayAgent / RoleplayEvaluator / ExpressionOptimizer / SummaryGenerator（DeepSeek 结构化输出）
│   │   └── data/
│   │       ├── courses.json             # 【新增】预置课程内容
│   │       └── progress.json            # 【运行时生成】学习进度（git ignore）
│   ├── webapp.py                        # 【修改】追加 /course/catalog、/course/progress、/course/lesson/start、/course/lesson/step
│   └── tools/audio_tool/xfyun_tts/      # 【复用】/audio/tts 已满足朗读需求
├── tests/unit_tests/
│   ├── test_text_match.py               # 【新增】
│   ├── test_course_repository.py        # 【新增】
│   └── test_progress_repository.py      # 【新增】
└── langgraph.json                       # 【不改】course_agent 注册路径仍指向 course_graph.py:graph

frontend/
├── components/
│   ├── main-tab-shell.tsx               # 【修改】tab2 分支 EmptyTab → CoursePage
│   ├── empty-tab.tsx                    # 【保留】不再被 tab2 使用（可留作兜底）
│   └── course/
│       ├── course-page.tsx              # 【新增】精品课 Tab 容器：列表 / 详情 / 学习页切换
│       ├── course-card.tsx              # 【新增】课程卡片
│       ├── course-category-section.tsx  # 【新增】分类分组
│       ├── course-detail.tsx            # 【新增】章节 + 课时清单
│       ├── lesson-player.tsx            # 【新增】学习页主容器：按 stage 渲染 + 下一步
│       ├── stage-intro.tsx              # 【新增】场景 + 核心句 + TTS 朗读 + 跟读输入
│       ├── stage-knowledge.tsx          # 【新增】知识点卡片
│       ├── stage-exercise.tsx           # 【新增】题目 / 作答 / 评价 / 重试
│       ├── stage-roleplay.tsx           # 【新增】角色扮演对话 + 每轮评价
│       └── stage-summary.tsx            # 【新增】总结 + 完成
├── lib/
│   ├── course-api.ts                    # 【新增】课程接口封装（经 /api 代理）
│   ├── course-store.ts                  # 【新增】Zustand：当前课程/课时/stage/session
│   └── course-types.ts                  # 【新增】与后端契约对齐的 TS 类型
└── app/api/[..._path]/route.ts          # 【不改】沿用代理
```

## Phase 0 决策摘要（详见 [research.md](./research.md)）

- **R1 图接入方式**：HTTP 端点内部直接调用编译后的课时图（`ainvoke` / `Command(resume=)`），前端不接 LangGraph SDK；每次响应 = 一个 `stage` 快照。
- **R2 续学**：`InMemorySaver` + `progress.json` 记录已完成环节与用户输入历史；重新进入时按进度快进。
- **R3 进度存储**：后端 JSON 文件，写时原子替换（临时文件 + `os.replace`），并发用文件锁。
- **R4 课程数据**：单文件 `courses.json`，分类/课程/章节/课时四级，课时内嵌练习题与角色扮演设定。
- **R5 TTS**：复用现有 `POST /audio/tts`（accent=american），不新增语音能力。
- **R6 比对规则**：归一化（去首尾空白、转小写、去标点、压缩连续空格）后完全相等即通过；不等则视为不通过，重试计数上限 2。

## Phase 1 输出

- [data-model.md](./data-model.md)：课程四级实体 + 进度状态机 + JSON 结构
- [contracts/course-catalog.md](./contracts/course-catalog.md)、[contracts/lesson-session.md](./contracts/lesson-session.md)
- [quickstart.md](./quickstart.md)：启动与端到端验证清单
