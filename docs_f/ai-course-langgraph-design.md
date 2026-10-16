d:\shuo.learn\work project\dialog-ai\docs\ai-course-langgraph-design.md
# AI 精品课程系统 · LangGraph 架构设计 v1.1（纯文本版）

> 状态：设计稿，待确认后生成 agent.drawio 和 Python 代码
> 任务书来源：ai精品课.txt
> 本版本变化：剥离语音能力（ASR / 发音评测），跟读改为打字比对

## 1. 系统定位

课程内容（分类 → 课程 → 章节 → 课时）由系统预置，不由 LLM 自由生成。
AI 职责：跟读检查、答案评价、反馈生成、角色扮演、表达优化、学习总结。
总体原则：固定课程 Workflow + 局部智能 Agent/LLM 节点 + LangGraph 状态管理和流程编排。
不设计包办一切的超级 Agent。

## 2. 完整业务流程

用户进入课时
  → load_lesson_context   查课程库，加载课时全量数据
  → present_scene         呈现场景说明（固定内容）
  → present_target_sentence 呈现核心句（固定内容）
  → user_type_sentence    用户照核心句打字（interrupt 等待输入）
  → check_typed_sentence  普通代码比对（归一化后相似度 ≥ 0.9 放行，上限重试 2 次）
  → teach_knowledge       知识点讲解（固定内容）
  → exercise_subgraph     练习环节（出题→答题→LLM评价→反馈→重试环）
  → roleplay_subgraph     角色扮演环节（AI对话→LLM评价→优化→继续环，MAX_ROUNDS=3）
  → lesson_summary        LLM 生成个性化总结
  → update_progress       写学习记录库
  → finalize_lesson       标记课时完成
  → END

## 3. Agent 划分（LLM 节点，全部结构化输出）

| Agent | 职责边界 | 输出字段 |
|---|---|---|
| AnswerEvaluator | 只评价练习答案（语义/句型/语法/可接受度 5 条标准） | is_correct, error_type, score, is_acceptable |
| FeedbackGenerator | 只根据评价结果生成反馈和改进提示 | feedback, suggestion, model_answer |
| RoleplayAgent | 只扮演对话角色推进情景，不评价 | response, roleplay_finished |
| RoleplayEvaluator | 只评价用户表达（6 条标准：完成任务/核心表达/语义/语法/场景/自然度） | task_completed, used_core_expression, score, error_type |
| ExpressionOptimizer | 只优化不自然的表达并解释 | natural_expression, explanation |
| SummaryGenerator | 只汇总掌握情况生成总结 | summary, mastered_points, next_suggestion |

红线：
- 任何 Agent 不得决定"下一步去哪个节点"，路由只由代码读结构化字段
- 评价与反馈分离；Roleplay 只演不评
- 可接受表达 ≠ 标准答案，不因未复现标准答案判错

## 4. Node 划分（普通代码节点）

load_lesson_context / present_scene / present_target_sentence /
user_type_sentence(interrupt) / check_typed_sentence /
teach_knowledge / update_progress / finalize_lesson / error_handler / route_* 系列

## 5. Tool / 外部服务（纯文本版）

| 名称 | 说明 | 失败策略 |
|---|---|---|
| course_repository | 课程数据（MVP 先用 lesson.json） | 不 Retry，失败终止 |
| progress_repository | 学习记录（MVP 先本地暂存） | Retry 3 次后降级暂存 |

已移除（语音版恢复时再启用）：speech_to_text、pronunciation_assessment

## 6. State Schema

class LessonState(TypedDict):
    user_id: str
    course_id: str
    chapter_id: str
    lesson_id: str
    scene_description: str
    target_sentence: str
    knowledge_points: Annotated[list, operator.add]
    exercises: list[Exercise]
    current_question: Exercise | None
    expected_answer: str | None
    typed_text: str                # 用户打字输入（语音版换回 recognized_text）
    user_answer: str
    evaluation: Evaluation | None
    feedback: str
    exercise_index: int
    retry_count: int
    roleplay_context: list         # Annotated add 追加
    roleplay_response: str
    roleplay_evaluation: RoleplayEval | None
    roleplay_rounds: int
    summary: str
    lesson_completed: bool
    error: str | None

职责分离：
- Runtime Context：llm 模型名、评分标准、库连接（不可变）
- Short-term Memory：roleplay_context（随 checkpoint 持久化）
- Long-term Memory：用户画像/错题本（不进本图，由独立 Store 读写）
- Checkpoint：thread_id = "{user_id}:{lesson_id}"，断点续学

## 7. Conditional Routing（全部普通代码）

| 路由 | 条件 → 去向 |
|---|---|
| route_after_check | 匹配 → teach_knowledge；不匹配&<2次 → user_type_sentence；≥2次 → 放行 |
| route_after_evaluation | 正确/可接受 → advance；错&retry<2 → generate_feedback；≥2 → reveal_answer 放行 |
| route_after_exercise | 还有题 → generate_question（环）；没有 → enter_roleplay |
| route_after_roleplay_eval | 完成 → lesson_summary；未完&<3轮 → optimize_expression（环）；≥3轮 → 放行总结 |
| route_on_error | error 非空 → error_handler |

## 8. Loop 设计

1. 跟读比对环：check 不匹配重试，上限 2
2. 练习重试环：evaluate→feedback→wait_answer，MAX_RETRY=2
3. 多题推进：exercise_index 递增驱动，题间顺序边
4. 角色扮演环：evaluate→optimize→ai_reply，MAX_ROUNDS=3
所有环硬上限由路由代码强制，LLM 无权延长。

## 9. Retry / Fallback / Error Handling

| 故障 | 策略 |
|---|---|
| LLM 结构化输出解析失败 | 节点内 Retry 2（带错误重发）→ 规则模板兜底 |
| LLM 超时/网络 | Retry 2（指数退避）→ 练习降级关键词匹配；角色扮演直接进总结 |
| 课程库失败 | 不 Retry，终止并提示系统异常 |
| 进度库失败 | Retry 3 → 本地暂存，图继续 |
| 用户超时未答 | interrupt 层超时视为放弃，checkpoint 保存等待续学 |

统一出口：节点异常写 state["error"] → error_handler → 保证图永远可终止。

## 10. Memory / Checkpoint

- Checkpointer：生产 AsyncPostgresSaver / 开发 InMemorySaver
- thread_id = "{user_id}:{lesson_id}"，支持断点续学
- Runtime Context：context_schema = AppContext(llm, rubric, db)
- 跨课时画像由 update_progress 通过独立 Store 写，不进图 State

## 11. Subgraph

| Subgraph | 内部 | 接口 |
|---|---|---|
| exercise_subgraph | generate_question → wait_answer → evaluate_answer → (feedback→wait_answer) \| advance | 入：exercises；出：scores, final_answers |
| roleplay_subgraph | enter_roleplay → ai_reply → wait_user → evaluate → (optimize→ai_reply) \| finish | 入：核心句/场景；出：rounds, task_completed, final_expression |

不建为 Subgraph：跟读（线性短流程）、总结/进度（单节点）。
不使用：Fan-out/Fan-in、Send（无并行需求）、Command（条件边足够，避免控制流与状态耦合）。

## 12. 架构图（文字版）

MAIN GRAPH
START
 └─ load_lesson_context（失败→ error_handler → END）
    present_scene
    present_target_sentence
    user_type_sentence (interrupt)
    check_typed_sentence ──不匹配&<2次→ user_type_sentence（环）
    teach_knowledge
 └─ exercise_subgraph（Evaluator-optimizer 环，MAX_RETRY=2）
 └─ roleplay_subgraph（MAX_ROUNDS=3）
    lesson_summary
    update_progress ──写库失败→ 降级暂存
    finalize_lesson
END

## 13. 代码对应关系

| 架构元素 | Python |
|---|---|
| 主图 | StateGraph(LessonState, context_schema=AppContext) |
| Subgraph | 独立 compile 后 add_node 挂载 |
| 等待用户 | interrupt() / Command(resume=...) |
| 结构化输出 | llm.with_structured_output(Model) |
| 重试 | 节点内循环（LLM 层）+ 路由计数（流程层） |
| Checkpoint | compile(checkpointer=saver) |
| 条件路由 | add_conditional_edges(...) |

## 14. MVP 实施批次

第一批：主图骨架 + 跟读（打字比对）+ 知识点展示 + 练习 Subgraph（LLM 评价/反馈/重试环）
第二批：角色扮演 Subgraph + 学习总结
第三批：进度持久化 + checkpoint 断点续学

课程数据：MVP 先用 lesson.json（"今天我心情特别好"完整课时），后续接数据库。