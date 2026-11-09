# Data Model: 精品课（精讲课对话）

**Feature**: 005-premium-course | **Date**: 2026-11-06

## 1. 课程目录（只读，`backend/src/course_agent/data/courses.json`）

```json
{
  "version": 1,
  "categories": [
    {
      "id": "daily",
      "name": "日常交流",
      "order": 1,
      "courses": [
        {
          "id": "mood-today",
          "name": "今天我心情特别好",
          "description": "学会表达情绪与近况，掌握 5 个高频口语表达",
          "cover_color": "green",
          "order": 1,
          "chapters": [
            {
              "id": "mood-today-ch1",
              "name": "第一章 · 表达情绪",
              "order": 1,
              "lessons": [
                {
                  "id": "mood-today-l1",
                  "name": "1-1 说出我的好心情",
                  "order": 1,
                  "scene": "早上在咖啡店遇到同事 Lily，她问你今天怎么样。",
                  "target_sentence": "I'm in a really good mood today.",
                  "knowledge_points": [
                    {"title": "in a good mood", "explanation": "表示心情好，比 I'm happy 更口语化。", "example": "I'm in a great mood this morning."}
                  ],
                  "exercises": [
                    {
                      "id": "ex1",
                      "question": "你想说“我今天心情特别好”，用刚学的表达怎么说？",
                      "reference_answer": "I'm in a really good mood today.",
                      "key_points": ["good mood"]
                    }
                  ],
                  "roleplay": {
                    "role": "Lily（同事）",
                    "setting": "咖啡店里，Lily 关心你最近的状态。",
                    "opening_line": "Hey! You look happy today. What's going on?",
                    "goal": "用至少 2 句话说明心情好的原因",
                    "max_rounds": 3
                  }
                }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

**约束**：
- `id` 全局唯一、稳定，前端路由与进度都以它为键
- `order` 仅用于排序，允许重复
- `max_rounds` 默认 3（spec FR-010 上限）
- 课时至少 1 个知识点、1 道练习题、1 组角色扮演设定，否则视为数据不合法

## 2. 学习进度（读写，`backend/src/course_agent/data/progress.json`）

```json
{
  "version": 1,
  "updated_at": "2026-11-06T15:30:00+08:00",
  "lessons": {
    "mood-today-l1": {
      "status": "in_progress",
      "current_stage": "exercise",
      "completed_stages": ["intro", "knowledge"],
      "retry_counts": {"intro": 1, "ex1": 0},
      "answered": {"ex1": "I am in a good mood today."},
      "roleplay_transcript": [
        {"role": "assistant", "text": "Hey! You look happy today. What's going on?", "evaluation": null},
        {"role": "user", "text": "I got a new job!", "evaluation": {"score": "good", "suggested": "I just got a new job!"}}
      ],
      "started_at": "2026-11-06T15:20:00+08:00",
      "completed_at": null
    }
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `status` | `not_started` \| `in_progress` \| `completed` | 课时状态 |
| `current_stage` | `<Stage>` | 续学的落点 |
| `completed_stages` | `<Stage>[]` | 已完成环节，用于跳过 |
| `retry_counts` | `Record<string, number>` | 跟读 / 练习的重试计数，键为 `intro` 或 exercise id |
| `answered` | `Record<string, string>` | 练习作答，键为 exercise id |
| `roleplay_transcript` | `Turn[]` | 角色扮演历史，续学与总结用 |
| `started_at` / `completed_at` | ISO 字符串 \| null | 时间戳 |

**幂等**：`status = completed` 再次写入不改 `completed_at`，不重复累加（spec FR-019）。

## 3. 状态机（`Stage`）

```text
not_started
   │ start
   ▼
 intro ──► knowledge ──► exercise ──► roleplay ──► summary ──► completed
  ▲           ▲            │            │            │
  └───────────┴────────────┴────────────┴────────────┘  （中途退出，进度文件记录 current_stage）
```

| Stage | 前端组件 | 推进条件 |
|-------|----------|----------|
| `intro` | `stage-intro.tsx` | 跟读归一化比对通过，或重试满 2 次 |
| `knowledge` | `stage-knowledge.tsx` | 用户点"下一步" |
| `exercise` | `stage-exercise.tsx` | 全部题目完成（每题答对 / 重试满 2 次看答案后确认） |
| `roleplay` | `stage-roleplay.tsx` | 达 `max_rounds` 轮或用户主动结束 |
| `summary` | `stage-summary.tsx` | 用户点"完成课时" |
| `completed` | — | 写进度，返回详情页 |

**红线**：stage 流转由图的条件边决定（`lesson_graph.py`），任何 AI 输出都不参与路由。

## 4. LessonState（`lesson_state.py`）

| 字段 | 类型 | 说明 |
|------|------|------|
| `user_id` | `str` | 固定 `"local"`（单用户） |
| `course_id` / `chapter_id` / `lesson_id` | `str` | 定位 |
| `lesson` | `dict` | 从 `course_repository` 载入的课时数据 |
| `stage` | `str` | 当前环节，用于生成 `interrupt` payload |
| `target_sentence` | `str` | 核心句 |
| `user_input` | `str` | 本次 resume 的原始输入 |
| `typed_ok` | `bool` | 跟读是否通过 |
| `retry_count` | `int` | 当前环节重试次数 |
| `exercise_index` | `int` | 练习题序号 |
| `exercise_result` | `dict \| None` | 单题评价结果 |
| `roleplay_round` | `int` | 角色扮演轮次 |
| `roleplay_messages` | `list` | 对话历史（`add_messages` 风格用普通 dict 数组即可） |
| `evaluations` | `list` | 累积评价（总结用） |
| `summary` | `dict \| None` | 总结结果 |
| `progress` | `dict` | 写回进度文件前的快照 |
| `error` | `str \| None` | 降级标记 |

## 5. 前后端类型对齐

`frontend/lib/course-types.ts` 必须与本文档字段一一对应；`CourseLesson.status` 由后端在目录接口中计算后下发，前端不自行推导。
