---

description: "Tasks for 004-correction-translation (纠错气泡原句翻译「文A」)"
---

# Tasks: 纠错气泡原句翻译（文A）

**Input**: Design documents from `/specs/004-correction-translation/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/translation-bypass-contract.md, quickstart.md

**Tests**: 后端 pytest 测试已在 plan.md Testing 明确请求（translate_node 单测 + 子图集成测试），故包含测试任务；前端无单测请求，验证以 oxlint + tsc + quickstart.md 手动验收为准。

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Web app**: `backend/src/`（Python + LangGraph）、`frontend/`（Next.js App Router）

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: 确认 003 收敛后的改动基线，保证后续任务在干净起点上验证零回归

- [x] T001 记录基线：运行 `uv run pytest`（backend/，确认 18 个既有单测全绿）与 `pnpm exec oxlint` + `pnpm exec tsc --noEmit`（frontend/，记录既有基线错误——已知 `components/tool-fallback.aui.tsx(445,74)` TS2339 为 003 前遗留，不算新增）
  **已完成**：pytest 有效范围（unit_tests + tutor 集成）23/23 绿（另发现 2 个与本 feature 无关的遗留文件 collection error：`docs_f/grammar_check_parent_test.py`、`tests/integration_tests/test_graph.py`，均为历史遗留不处理）；oxlint 0 警告 0 错误；tsc 仅既有基线 TS2339 一处

**Checkpoint**: 基线确认 —— 后端测试绿、前端基线错误清单在案，后续验证以此为对照

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 后端翻译旁路与前端请求基础设施，三个 US 全部依赖

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T002 后端翻译旁路：在 `backend/src/talk_agent/subgraphs/grammar_tutor_subgraph/grammar_tutor_subgraph.py` 新增 `translate_node`（ChatDeepSeek 纯文本翻译，prompt 要求英→中、中文完整语义为主、仅输出译文本身；`raw_text` 为空/纯空白不调 LLM 直接返回空串；LLM 异常捕获返回空串，不抛错——同 tts_node 兜底风格）；`TutorState` 局部声明 `translate_request: bool` 与 `translation: str`（不进全局 state.py）；`route_entry` 返回值扩为 `Literal["tts_node", "translate_node", "load_input_node"]`（translate_request 优先判定）；拓扑接线 `add_node("translate_node", ...)` + route_entry 映射加分支 + `add_edge("translate_node", END)`；不改任何既有节点、不改 langgraph.json
  **已完成**：translate_node（L314-349，含 TRANSLATE_SYSTEM_PROMPT）、TutorState 加 translate_request/translation（L61-62）、route_entry 三分支（L353-364，翻译优先）、拓扑三入口（L386/L388-396/L407）；模块 docstring 同步「翻译懒加载」说明
- [x] T003 后端测试：新增 `backend/tests/unit_tests/test_translate_node.py`（覆盖：正常译文非空纯文本、空/空白 raw_text 不调 LLM 返回空串、LLM 异常返回空串三场景，LLM 调用 mock 不需真实 API key）；扩展 `backend/tests/integration_tests/test_grammer_tutor_subgraph.py` 增加 translate_request 旁路场景（invoke `{translate_request: true, raw_text}` 终态含非空 translation；需 DEEPSEEK_API_KEY）；运行 `uv run pytest` 确认既有 18 个单测 + 新增用例全绿
  **已完成**：单测 8 用例（route_entry 三分支 + translate_node 五场景：成功/空输入×3/异常/不可用/非str content）；集成场景6（真实 LLM 翻译 + 验证不产讲解不产音频）；pytest 结果 unit_tests 26 passed、integration 6 场景全过
- [x] T004 [P] 前端翻译客户端：新建 `frontend/lib/translation-client.ts`（按 contracts/translation-bypass-contract.md 实现：`fetchTranslation(rawText)` POST `/api/runs/wait`，`assistant_id: process.env.NEXT_PUBLIC_TTS_ASSISTANT_ID || "grammer_tutor"`，input `{translate_request: true, raw_text}`，`stream_mode: "values"`；响应按 `data.values ?? data` 兼容解析取 `translation` 字段；HTTP 非 2xx 抛 `TranslationClientError`，空串译文原样返回不抛错；模块级 `translationCache = Map<messageId, string>` 会话内缓存与 `getTranslation(messageId, rawText)` 缓存优先入口——缓存实现一次到位供 US3 复用；代码风格照抄 `frontend/lib/tts-client.ts`）
  **已完成**：TranslationClientError / translationCache（空译文不缓存以便重试）/ getCachedTranslation / clearTranslationCache / fetchTranslation / getTranslation，注释含父图 HITL 坑位说明
- [x] T005 前端翻译 Hook：新建 `frontend/components/correction-bubble/use-translation.ts`（实现 data-model.md TranslationResult 状态机：`{ status: "idle"|"loading"|"success"|"failed", text, retry }`；`open` 驱动展开时缓存命中直接 success、未命中且非 loading 才发请求（防重守卫，Edge Case 1）；loading 中重复触发不重发；failed 后 `retry()` 重新走 loading；空 rawText 前置拦截不请求直接 failed/不可用；依赖 T004）
  **已完成**：四态状态机 + loadingRef 防重 + open/retry 语义分离；空原句拦截后状态留 idle，不可用提示展示分支由组件层处理（视图层派生，原则 III）

**Checkpoint**: 后端 `uv run pytest` 全绿（含 translate 旁路）+ curl 直调子图 `{translate_request: true}` 返回非空 translation（quickstart §6）→ 前端基础设施就绪，US 实现可开始

---

## Phase 3: User Story 1 - 查看原句中文翻译 (Priority: P1) 🎯 MVP

**Goal**: 点击「文A」在功能行下方、纠错讲解上方展示中文译文（加载中有表现）

**Independent Test**: 发送英文触发纠错气泡 → 点「文A」→ 功能行正下方出现译文（quickstart §1）

### Implementation for User Story 1

- [x] T006 [US1] 翻译区接线与位置调整：修改 `frontend/components/correction-bubble/correction-bubble.tsx`——① 将翻译区从当前「讲解区之后、✅正确句之前」（L88-98 附近）移动到「功能行（CorrectionToolbar）之下、讲解区之上」，上下各以虚线分隔线区隔（样式对齐 spec Assumptions 第 6 条布局：原句行→功能行→虚线→译文行→虚线→讲解→分隔线→✅正确句）；② 接入 `useTranslation`（依赖 T005）：`translationOpen` 为真时渲染——`loading` 态显示加载中文案（含脉冲动画，风格参照 follow-along-panel 的加载表现），**移除现有「暂无翻译」占位文本**；`success` 态渲染译文纯文本（`text-sm` 常规色，非 muted 灰，随内容自动换行）；删除旧的占位 div；不动 toolbar、actions、score-bar、音频链路
  **已完成**：翻译区移位至讲解前（border-y dashed 分隔）、handleToggleTranslation 展开时触发 open、loading 脉冲圆点「翻译中…」、success 常规色译文、failed 可点击重试文案、「暂无翻译」占位已删除；整文件重写保证缩进
- [x] T007 [US1] 验证 US1：`pnpm exec oxlint` + `pnpm exec tsc --noEmit`（基线外零新错误）；启动前后端手动走 quickstart §1（译文位置正确、加载态可见、无「暂无翻译」字样、Console 无新增报错）
  **已完成（自动化部分）**：oxlint 50 文件 0 警告 0 错误；tsc 仅既有基线 TS2339 一处零新增。人工走查（quickstart §1）并入 T012 最终验收

**Checkpoint**: US1 独立可用 —— 点「文A」看到译文出现在截图指定位置（MVP 交付点）

---

## Phase 4: User Story 2 - 翻译失败反馈 (Priority: P2)

**Goal**: 翻译失败行内可见、可重试，不阻塞气泡其他功能

**Independent Test**: 停后端点「文A」出现失败提示，恢复后重试成功（quickstart §3）

### Implementation for User Story 2

- [x] T008 [US2] 失败态与重试：在 `frontend/components/correction-bubble/correction-bubble.tsx` 翻译区补 `failed` 态渲染——行内文案「翻译获取失败，请重试」（`text-muted-foreground text-sm`，与区域同位，无弹窗无跳转），文案可点击触发 `retry()`（依赖 T005 的 retry 通道）；空原句场景显示「暂无可用翻译」类不可用提示（区分于失败：不提供重试）；确认失败态下功能行三按钮、AI 发音、跟读、复制均正常响应（FR-006）
  **已完成**：failed 态渲染为可点击 button（retry 通道），文案按 analyze F2 建议与加载占位明确区分；空原句渲染「原句为空，无法翻译」终态（不提供重试）；失败态不触碰其他组件无阻塞路径（FR-006 由结构保证：翻译区独立于 toolbar/actions/音频链路）
- [x] T009 [US2] 验证 US2：手动走 quickstart §3（停后端→失败提示出现且无弹窗→恢复→点击重试成功展示译文）；§4 防重（慢响应期连续点击仅一次请求，DevTools Network 确认）
  **已完成（代码侧）**：重试链路（button onClick → retry → request）与防重守卫（loadingRef）代码就绪；人工走查（quickstart §3/§4）并入 T012 最终验收

**Checkpoint**: US1 + US2 独立可用 —— 失败可见可重试，主链路不受影响

---

## Phase 5: User Story 3 - 重复查看零等待 (Priority: P3)

**Goal**: 同会话重复查看译文直接显示，零网络请求

**Independent Test**: 取得译文后收起再展开，译文即时显示且 Network 无新请求（quickstart §2）

### Implementation for User Story 3

- [x] T010 [US3] 缓存复用验证与收尾：确认 `getTranslation` 缓存命中路径在「收起（translationOpen=false）→ 再展开」场景直接渲染 success 译文（无 loading 闪现、Network 面板无新 /api/runs/wait 请求，quickstart §2）；确认刷新页面后缓存重置、重新点击正常重新请求（Edge Case 4）；确认多条纠错气泡各自译文互不串扰（缓存按 messageId 隔离）
  **已完成（代码侧）**：缓存命中路径（getTranslation 首行查 Map）+ 空/失败不缓存（允许重试）+ 按 messageId 隔离（每气泡独立 hook 实例 + Map 键隔离）；刷新重置由模块级 Map 生命周期天然保证；人工走查（quickstart §2）并入 T012 最终验收

**Checkpoint**: 三个 US 全部独立可用

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: 全量回归与人工验收

- [x] T011 全量自动化验证：`uv run pytest`（backend/ 全绿，确认 003 既有测试零回归）+ `pnpm exec oxlint` + `pnpm exec tsc --noEmit`（frontend/，基线外零新错误）
  **已完成**：pytest unit_tests 26 passed（18 既有 + 8 新增）+ integration 6 场景全过（含真实 LLM 翻译场景6）；oxlint 50 文件 0 警告 0 错误；tsc 仅既有基线 TS2339 一处——003 测试与类型零回归
- [x] T012 零回归走查与后端直验：手动走 quickstart §5 全项（AI 发音双按钮含失败轻提示、跟读面板加载反馈与防重、全局音频互斥、复制/收藏、评分条入口、普通消息/新对话/HITL/选场景）；§6 curl 双旁路直验（translate_request 出 translation、tts_request 出 raw_audio/tutor_audio，route_entry 三分支互不干扰）
  **已完成（2026-10-27）**：用户人工验收通过，确认「文A」功能全部正常（quickstart §1~§5 全过）

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: T001 无依赖，立即执行
- **Foundational (Phase 2)**: 依赖 T001 基线确认；T002→T003 串行（测试随实现）；T004 与 T002/T003 可并行（不同仓库目录）；T005 依赖 T004
- **US1 (Phase 3)**: 依赖 T005 + T002（联调需后端旁路就绪）
- **US2 (Phase 4)**: 依赖 T007（US1 验证通过）
- **US3 (Phase 5)**: 依赖 T009
- **Polish (Phase 6)**: 依赖 T010

### User Story Dependencies

- **US1 (P1)**: Foundational 完成后即可实现，不依赖其他 story
- **US2 (P2)**: 复用 US1 建立的翻译区渲染结构，仅增补 failed 分支
- **US3 (P3)**: 缓存实现在 Foundational（T004/T005）一次到位，本 story 为行为验证与收尾

### Parallel Opportunities

- T002/T003（后端）与 T004（前端客户端）可并行——不同目录、契约已冻结
- T011 的 pytest 与 oxlint/tsc 可并行执行

---

## Parallel Example: Foundational

```text
# 后端线（串行）：
Task: "T002 translate_node + route_entry 三分支（grammar_tutor_subgraph.py）"
Task: "T003 后端测试（unit + integration 扩展）"

# 前端线（与后端并行）：
Task: "T004 translation-client.ts（按契约实现，不等后端）"

# 汇合：
Task: "T005 use-translation.ts（依赖 T004）"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup（T001）
2. Complete Phase 2: Foundational（T002~T005，后端+前端双线并行）
3. Complete Phase 3: US1（T006~T007）
4. **STOP and VALIDATE**: quickstart §1 通过即主价值交付（译文可见）

### Incremental Delivery

1. MVP（US1）→ 2. US2 失败反馈 → 3. US3 零等待 → 4. Polish 全量回归
5. 每个 Checkpoint 均可独立演示

---

## Notes

- 本 feature 后端改动仅 T002 单文件（grammar_tutor_subgraph.py），与 003 TTS 旁路同构，不新增端点/注册键
- 翻译区位置调整（T006）是用户参照截图指定的硬性验收点，位置以 spec Assumptions 第 6 条文字描述为准
- 浏览器自动化对 React 受控组件不可靠（项目既有教训），US2/US3/Polish 的人工走查项由用户执行，AI 侧以 Network/Console 证据与代码审查辅助
- Commit after each task or logical group（用户发话后执行）
