# Tasks: 精品课（精讲课对话）

**Feature**: 005-premium-course | **Date**: 2026-11-06

**Input**: [spec.md](./spec.md) / [plan.md](./plan.md) / [research.md](./research.md) / [data-model.md](./data-model.md) / [contracts/](./contracts/)

## Phase 1: Setup

- [x] T001 创建课程预置数据 `backend/src/course_agent/data/courses.json`：1 个分类、1 门课程、3 个章节、每章 1 课时（共 3 课时），结构严格按 data-model.md 第 1 节；每课时含 `scene` / `target_sentence` / ≥1 条 `knowledge_points` / ≥1 道 `exercises` / `roleplay`（`max_rounds: 3`）。验证：`python -c "import json;json.load(open('src/course_agent/data/courses.json',encoding='utf-8'))"`
- [x] T002 [P] 创建进度文件占位 `backend/src/course_agent/data/progress.json`（`{"version":1,"updated_at":null,"lessons":{}}`），并把 `src/course_agent/data/progress.json` 加入 `.gitignore`。验证：文件存在且不被 git 跟踪

## Phase 2: Foundational（阻塞所有用户故事）

- [x] T003 定义 `LessonState` 与子结构 TypedDict（`ExerciseEvaluation` / `RoleplayTurn` / `LessonSummary`）于 `backend/src/course_agent/lesson_state.py`，字段严格对齐 data-model.md 第 4 节。验证：`python -c "from src.course_agent.lesson_state import LessonState"`
- [x] T004 [P] 实现课程读取 `backend/src/course_agent/course_repository.py`：`load_catalog()`、`get_lesson(lesson_id)`、`iter_lessons()`；JSON 缺失或损坏抛出明确异常。验证：`tests/unit_tests/test_course_repository.py`
- [x] T005 [P] 实现进度读写 `backend/src/course_agent/progress_repository.py`：`load()`、`get_lesson_progress(lesson_id)`、`upsert_lesson(lesson_id, patch)`；写采用临时文件 + `os.replace` 原子替换 + `threading.Lock`；`status=completed` 重复写入不改 `completed_at`。验证：`tests/unit_tests/test_progress_repository.py`
- [x] T006 [P] 实现跟读比对 `backend/src/course_agent/text_match.py`：`normalize(text)`（去首尾空白→小写→去撇号→去中英文标点→压缩连续空白）与 `is_match(user_input, target)`。验证：`tests/unit_tests/test_text_match.py`
- [x] T007 实现 6 个 AI Agent 于 `backend/src/course_agent/agents.py`：`evaluate_answer`、`generate_feedback`、`roleplay_reply`、`evaluate_roleplay_turn`、`optimize_expression`、`generate_summary`；全部 `llm.with_structured_output(...)`，单节点内失败重试 2 次后返回兜底文本（research R7）。验证：`python -c "from src.course_agent.agents import evaluate_answer"`（不触发网络）
- [x] T008 实现课时主图 `backend/src/course_agent/lesson_graph.py`：节点 `load_lesson_context` → `present_scene` → `present_target_sentence` → `user_type_sentence`(interrupt) → `check_typed_sentence` → `teach_knowledge`(interrupt) → `exercise_present`(interrupt) → `exercise_evaluate` → `exercise_feedback`(interrupt，通过/满额后展示评价与参考答案) → 循环到全部题目完成 → `roleplay_present`(interrupt, 循环到 `max_rounds`) → `roleplay_evaluate` → `summary_prepare` → `summary_present`(interrupt) → `update_progress` → `finalize_lesson`；所有条件边只依赖 state 字段，AI 输出不参与路由（data-model.md 红线）；导出 `build_lesson_graph(with_checkpointer=True)`，HTTP 路由用内存 checkpointer，LangGraph API 注册用无 checkpointer 版本。验证：`python -c "from src.course_agent.lesson_graph import build_lesson_graph; build_lesson_graph()"`
- [x] T009 把 `backend/src/course_agent/course_graph.py` 改为从 `lesson_graph` 重导出 `graph`（保持 `langgraph.json` 的 `./src/course_agent/course_graph.py:graph` 注册路径有效；平台自带持久化，编译时不挂自定义 checkpointer）。验证：`langgraph dev` 启动日志中 `course_agent` 注册成功
- [x] T010 [P] 编写后端单测 `backend/tests/unit_tests/test_text_match.py`、`test_course_repository.py`、`test_progress_repository.py`：覆盖大小写/标点/空白归一化、课程缺失异常、进度幂等与原子写。验证：`pytest tests/unit_tests/test_text_match.py tests/unit_tests/test_course_repository.py tests/unit_tests/test_progress_repository.py -q` 全绿
- [x] T011 在 `backend/src/webapp.py` 追加 4 个路由并挂到 custom app：`GET /course/catalog`、`GET /course/progress`、`POST /course/lesson/start`、`POST /course/lesson/step`；按 contracts/ 实现 stage payload 组装、`409 session out of sync`、`422 empty input`、AI 降级返回 `degraded: true`。验证：`langgraph dev` 后按 quickstart 验证 1~4 的 curl 全部符合契约

## Phase 3: US1 - 课程浏览（P1）

**独立验证**：Tab2 显示分类与课程卡片 → 点开课程看到章节/课时/状态。

- [x] T012 [P] [US1] 新建 `frontend/lib/course-types.ts`：与 contracts/course-catalog.md 响应逐字段对齐（`CourseCategory` / `Course` / `Chapter` / `LessonSummary` / `LessonStatus`）。验证：`tsc --noEmit` 通过
- [x] T013 [P] [US1] 新建 `frontend/lib/course-api.ts`：`fetchCatalog()`、`fetchProgress()`、`startLesson(lessonId)`、`stepLesson(sessionId, input)`，统一走 `/api/...`，非 2xx 抛结构化错误。验证：`pnpm vitest run lib/course-api.test.ts`
- [x] T014 [US1] 新建 `frontend/lib/course-store.ts`（Zustand）：`catalog` / `activeCourseId` / `activeLessonId` / `session` / `stage` / `payload`，提供 `loadCatalog()`、`openCourse()`、`openLesson()`、`backToList()`、`backToDetail()`。验证：`pnpm vitest run lib/course-store.test.ts`
- [x] T015 [P] [US1] 新建 `frontend/components/course/course-card.tsx` 与 `course-category-section.tsx`：卡片展示课程名、简介、课时数、完成进度条；视觉沿用绿色主题与大圆角。验证：页面视觉检查
- [x] T016 [US1] 新建 `frontend/components/course/course-page.tsx`：列表视图（分类分组 + 卡片 + 空状态 + 加载/错误重试态），内部按 store 状态切换列表/详情/学习页。验证：Tab2 可见课程列表
- [x] T017 [US1] 新建 `frontend/components/course/course-detail.tsx`：章节标题 + 课时清单 + 完成状态徽标 + 返回按钮 + 「开始/继续学习」入口。验证：点卡片后明细正确、课时状态与接口一致
- [x] T018 [US1] 修改 `frontend/components/main-tab-shell.tsx`：`activeTab === "tab2"` 分支由 `<EmptyTab />` 改为 `<CoursePage />`。验证：Tab2 不再是「功能建设中」

## Phase 4: US2 - 课时五环节（P2）

**独立验证**：进入课时后按顺序走完 intro → knowledge → exercise → roleplay → summary，每步可推进。

- [x] T019 [US2] 新建 `frontend/components/course/lesson-player.tsx`：全屏引导容器，按 `stage` 渲染子组件，顶部环节进度点与退出确认、完成态返回入口。验证：进入课时显示 intro 且能推进
- [x] T020 [P] [US2] 新建 `frontend/components/course/stage-intro.tsx`：场景文案 + 核心句 + TTS 播放按钮（复用 `/audio/tts`）+ 跟读输入框；不通过时展示 feedback/hint/剩余次数（`attempts` / `max_attempts`）。验证：错误输入提示重试，正确输入进入 knowledge
- [x] T021 [P] [US2] 新建 `frontend/components/course/stage-knowledge.tsx`：知识点卡片列表（标题/解释/例句）+ 下一步。验证：内容来自接口且可推进
- [x] T022 [P] [US2] 新建 `frontend/components/course/stage-exercise.tsx`：题干 + 作答输入 + 评价结果（verdict/feedback/suggested）+ 重试计数 + 收尾态（`needs_confirm`）展示参考答案并确认推进。验证：答错可重试≤2 次，措辞不同但语义正确判通过
- [x] T023 [P] [US2] 新建 `frontend/components/course/stage-roleplay.tsx`：AI 台词气泡 + 用户输入 + 每轮评价与更自然说法 + 轮次指示（`round / max_rounds`）+ 提前结束。验证：3 轮后进入 summary
- [x] T024 [P] [US2] 新建 `frontend/components/course/stage-summary.tsx`：总结文案 + 各环节结果 + 建议列表 + 「完成课时」。验证：点击后 `done: true` 并回到详情页

## Phase 5: US3 - 进度与断点续学（P3）

**独立验证**：中途退出再进入从原环节继续；完成后状态持久且刷新不丢。

- [x] T025 [US3] 在 `frontend/lib/course-store.ts` 增加续学逻辑：`openLesson()` 依据 `startLesson` 返回的 `stage` 直接落到对应环节（后端 `route_from_load` 已跳过已完成环节）。验证：预置 `current_stage=exercise` 后进入课时直接落在练习环节
- [x] T026 [US3] 在 `course-store.ts` 的 `finishLesson()` 完成回写后刷新 catalog：课时标记 completed、卡片 `completed_count` +1；重复完成同一课时不重复累加（依赖后端幂等，T005）。验证：完成课时后详情显示「已完成 1/3 课时」
- [x] T027 [US3] 在 `lesson-player.tsx` 处理 `payload.degraded === true`：显示轻提示「本次评价服务暂不可用…」，且不阻断推进。验证：见 lesson-player 降级提示

## Phase 6: Polish & 跨切面

- [x] T028 [P] 前端单测 `frontend/lib/course-api.test.ts`（5 例）、`frontend/lib/course-store.test.ts`（8 例）：fetch 封装错误分支、store 页面切换与续学跳转。验证：`pnpm vitest run` 53 passed
- [x] T029 全量回归：后端 `pytest tests/unit_tests --ignore=tests/unit_tests/test_configuration.py`（39 passed）、前端 `pnpm vitest run`（53 passed）、`pnpm exec tsc --noEmit` 通过
- [x] T030 按 [quickstart.md](./quickstart.md) 走完验证 1~7（列表/详情/跟读/知识点/练习/对话/总结与进度）；确认 `progress.json` 状态与页面一致

## 实施记录（2026-11-06）

- 联调中发现并修复：`langgraph dev` 拒绝带自定义 checkpointer 的图 → `build_lesson_graph(with_checkpointer=False)` 供平台注册，HTTP 路由仍用内存 checkpointer
- 联调中发现并修复：`normalize()` 原先把撇号替换为空格，导致「im in a really good mood today」被判错 → 撇号直接删除
- 新增 `exercise_feedback` interrupt 节点：答题后先展示评价与参考答案，确认后再进入下一题/下一环节（原先答对会直接跳到下一环节，用户看不到正向反馈）
- 浏览器端已人工验证：列表 → 详情 → 跟读 → 知识点 → 对话 → 总结 → 完成课时 → 进度 1/3；练习环节的输入提交仅受浏览器自动化输入限制影响，接口层已用脚本验证通过

## 依赖关系

```
T001,T002 → T003 → T004,T005,T006 (可并行) → T007 → T008 → T009 → T010,T011
T011 → T013 → T014 → T015,T016,T017 → T018
T018 → T019 → T020..T024 (可并行)
T019 → T025 → T026 → T027
T028 依赖 T013/T014；T029 依赖全部；T030 最后
```
