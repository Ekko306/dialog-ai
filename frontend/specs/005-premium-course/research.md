# Research: 精品课（精讲课对话）

**Feature**: 005-premium-course | **Date**: 2026-11-06

本阶段解决 plan 中的技术未知项，所有决策均已落地为可执行方案。

## R1 - 课时图如何被前端驱动

**Decision**: HTTP 端点内部驱动 LangGraph，前端只消费 `stage` 快照。

- `POST /course/lesson/start`：创建 thread（`thread_id = user_id:lesson_id`），跑图直到第一个 `interrupt()`，返回该阶段的展示数据 + `session_id`。
- `POST /course/lesson/step`：带 `session_id` + `input`，以 `Command(resume=input)` 续跑，直到下一个 `interrupt()` 或图结束。

**Rationale**: 前端不需要理解节点、边、interrupt 协议；只需按 `stage` 字段渲染对应组件。比让前端接 LangGraph SDK 的 thread/runs/interrupts 三套 API 简单一个数量级，且符合设计稿"流程由代码控制"。

**Alternatives considered**:
- 前端直连 LangGraph SDK（`useStream`）——与自由对话共用基础设施，但本功能是引导式流程而非消息流，需要一个自建的状态机包装层，反而更重。
- 拆成无状态 HTTP 接口（每个环节一个端点，后端不跑图）——违背设计稿的 LangGraph 编排要求，也无法体现 interrupt/checkpoint 能力。

## R2 - 断点续学怎么做

**Decision**: `InMemorySaver` 负责单次会话内 interrupt 恢复；跨会话续学由 `progress.json` 中的 `current_stage` + `completed_stages` 承载，重新 `start` 时按进度快进到对应环节。

**Rationale**: 引入持久化 checkpointer（SQLite/Postgres）需要新增依赖与迁移，MVP 阶段收益低。进度文件已经记录了"学到哪、答过什么"，足以恢复学习位置；图本身不需要跨进程复活。

**Alternatives considered**:
- `AsyncSqliteSaver`——能力完整，但需新增 `langgraph-checkpoint-sqlite` 依赖并处理 Windows 文件锁，MVP 不必。
- 完全依赖前端 localStorage——被 spec 否决（进度必须在后端）。

## R3 - 进度文件并发与写入安全

**Decision**: `progress_repository.write()` 采用"临时文件 + `os.replace`"原子替换，读改写全程持 `threading.Lock`（单进程 dev server 足够）。

**Rationale**: 避免半写文件导致进度损坏；`os.replace` 在 Windows 上同卷是原子的。

**Alternatives considered**: JSONL 追加（无法更新状态）；数据库（MVP 过重）。

## R4 - 课程数据格式

**Decision**: 单文件 `backend/src/course_agent/data/courses.json`，结构为 `categories[] → courses[] → chapters[] → lessons[]`，课时内嵌 `knowledge_points[]`、`exercises[]`、`roleplay{}`。

**Rationale**: 设计稿明确 MVP 先用 JSON；单文件便于人工编辑与演示；四级嵌套与前端三级页面天然对应。

**Alternatives considered**: 每课时一个 `lesson.json`（文件数多、加载零散）；数据库（超出 MVP）。

## R5 - 语音朗读

**Decision**: 直接复用现有 `POST /audio/tts`（默认 `accent=american`，发音人已切 `x4_EnUs_Laura_education`）。

**Rationale**: 端点、发音人、降级策略都已验证；本节只需前端一个播放按钮即可，无需后端新代码。

**Alternatives considered**: 课时进入时由后端预合成音频随 payload 返回——增加延迟与缓存复杂度，收益不明显。

## R6 - 跟读比对规则

**Decision**: 归一化后严格相等即通过。归一化 = 去首尾空白 → 转小写 → 去中英文标点 → 连续空白压成单空格。

**Rationale**: spec FR-006 只承诺"忽略大小写、首尾空白与标点差异"；不做模糊相似度，避免把明显错误的输入放行。每次不通过 +1，达到 2 次后放行（FR-007）。

**Alternatives considered**: Levenshtein 相似度 ≥0.9（设计稿提法）——容易被口语化改写误判为通过，且难以向用户解释；本期不采用，可在后续增强。

## R7 - AI 结构化输出与降级

**Decision**: 六个 Agent 全部 `llm.with_structured_output(Pydantic 模型)`；解析失败节点内重试 2 次，仍失败则走规则兜底（练习：关键词命中判正确；角色扮演：固定话术推进；总结：模板文本），保证课时能走到完成（spec FR-017）。

**Rationale**: 与现有 `grammer_tutor` 的实现方式一致，复用已验证的模式；红线是"AI 不得决定路由"，兜底只影响文案与判定，不影响边。

**Alternatives considered**: 纯文本输出 + JSON 正则解析——脆弱；让 AI 输出"下一步"指令——违反设计稿红线。
