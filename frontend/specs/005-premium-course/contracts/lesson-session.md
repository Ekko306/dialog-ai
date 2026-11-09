# Contract: 课时会话（开始 / 推进）

**Feature**: 005-premium-course | **Endpoints**: `POST /course/lesson/start`、`POST /course/lesson/step`

两个端点共同构成"一次 HTTP 请求 = 一个环节快照"的协议：后端内部驱动 LangGraph 到下一个 `interrupt()`，把该阶段渲染所需数据返回。前端不需要 `thread_id`、checkpoint、interrupt 等图概念。

## 1. 开始课时

```http
POST /course/lesson/start
Content-Type: application/json

{ "lesson_id": "mood-today-l1" }
```

**Response 200**

```json
{
  "session_id": "local:mood-today-l1:3f7a91bc",
  "stage": "intro",
  "payload": {
    "lesson_name": "1-1 说出我的好心情",
    "scene": "早上在咖啡店遇到同事 Lily，她问你今天怎么样。",
    "target_sentence": "I'm in a really good mood today.",
    "tts_text": "I'm in a really good mood today.",
    "attempts": 0,
    "max_attempts": 2,
    "feedback": null,
    "hint": "注意原句里的关键词，逐词对照一下"
  },
  "progress": { "status": "in_progress", "current_stage": "intro", "completed_stages": [] },
  "done": false
}
```

- `session_id` 为 `local:<lesson_id>:<8 位随机 hex>`：每次 start 开一个内存会话（图 checkpointer 是进程内实现），续学落点由 `progress.current_stage` 决定，不额外返回 `resumed` 字段
- 进度已存在时 start 直接快进到对应环节（`route_from_load`）：例如 `current_stage = "exercise"` 时首次响应即 `stage: "exercise"`
- 若该课时已 `completed`，仍可重新进入（复习），此时按完整流程重走，`progress.status` 在完成后保持 `completed`（`completed_at` 不覆盖）

## 2. 推进一步

```http
POST /course/lesson/step
Content-Type: application/json

{ "session_id": "local:mood-today-l1", "input": "I'm in a really good mood today." }
```

`input` 语义按当前 stage 而定：

| 当前 stage | input 含义 | 示例 |
|------------|-----------|------|
| `intro` | 用户跟读打的句子 | `"im in a really good mood today"` |
| `knowledge` | 任意非空文本（「开始练习」按钮） | `"ok"` |
| `exercise` | 未收尾：作答文本；`needs_confirm: true` 时：任意非空文本（确认进入下一题） | `"I am in a good mood today"` / `"continue"` |
| `roleplay` | 用户的一句回复（`"finish"` 表示提前结束） | `"I got a new job, so I'm happy."` |
| `summary` | 任意非空文本（「完成课时」按钮） | `"done"` |

**Response 200（因 stage 而异的 payload）**

`intro` 不通过且未满 2 次：

```json
{
  "stage": "intro",
  "payload": {
    "feedback": "还不够准确，再试一次～",
    "hint": "注意原句中的 good mood",
    "attempts": 1,
    "max_attempts": 2
  },
  "done": false
}
```

`knowledge`：

```json
{
  "stage": "knowledge",
  "payload": {
    "points": [
      {"title": "in a good mood", "explanation": "表示心情好，比 I'm happy 更口语化。", "example": "I'm in a great mood this morning."}
    ]
  },
  "done": false
}
```

`exercise`：

```json
{
  "stage": "exercise",
  "payload": {
    "exercise_index": 1,
    "exercise_total": 1,
    "question": "你想说“我今天心情特别好”，用刚学的表达怎么说？",
    "attempts": 0,
    "max_attempts": 2,
    "result": null,
    "reference_answer": null,
    "degraded": false
  },
  "done": false
}
```

答错后：

```json
{
  "stage": "exercise",
  "payload": {
    "exercise_index": 1,
    "exercise_total": 1,
    "question": "你想说“我今天心情特别好”，用刚学的表达怎么说？",
    "attempts": 1,
    "max_attempts": 2,
    "result": {"verdict": "incorrect", "feedback": "可以用 in a good mood 这个表达试试", "suggested": "I'm in a good mood today."},
    "reference_answer": null,
    "degraded": false
  },
  "done": false
}
```

本题收尾（通过或重试满额）由 `exercise_feedback` 节点 interrupt 返回，前端展示评价与参考答案后，
用任意非空 `input` 确认推进：

```json
{
  "stage": "exercise",
  "payload": {
    "exercise_index": 1,
    "exercise_total": 1,
    "question": "你想说“我今天心情特别好”，用刚学的表达怎么说？",
    "attempts": 1,
    "max_attempts": 2,
    "result": {"verdict": "correct", "feedback": "表达准确", "suggested": "I'm in a really good mood today."},
    "reference_answer": "I'm in a really good mood today.",
    "needs_confirm": true,
    "degraded": false
  },
  "done": false
}
```

`roleplay`：

```json
{
  "stage": "roleplay",
  "payload": {
    "round": 1,
    "max_rounds": 3,
    "ai_message": "That sounds great! What made today so good?",
    "evaluation": {"verdict": "acceptable", "feedback": "表达清楚，可以更自然一点", "suggested": "I just got a new job, so I'm really excited!"}
  },
  "done": false
}
```

`summary`：

```json
{
  "stage": "summary",
  "payload": {
    "summary": "本课你完成了跟读、知识点与练习，能用 in a good mood 表达心情。",
    "scores": {"intro": "passed", "exercise": "1/1", "roleplay_rounds": 3},
    "suggestions": ["下次试着用 excited 替换 good"]
  },
  "done": false
}
```

完成：

```json
{
  "stage": "completed",
  "payload": {"lesson_id": "mood-today-l1", "completed_at": "2026-11-06T15:40:00+08:00"},
  "done": true
}
```

## 错误约定

| 状态码 | 场景 | 响应体 |
|--------|------|--------|
| 404 | `lesson_id` 不存在 | `{"detail": "lesson not found"}` |
| 409 | `session_id` 与当前进度阶段不匹配（重复提交 / 过期会话） | `{"detail": "session out of sync", "current_stage": "exercise"}` |
| 422 | `input` 缺失或为空（`intro` / `exercise` / `roleplay` 阶段） | `{"detail": "empty input"}` |
| 200 + `error` | AI 环节降级 | 正常 stage 结构，payload 带 `"degraded": true` 与兜底文案 |

**降级行为**：AI 调用失败不返回 5xx，而是返回下一 stage 的兜底 payload（`degraded: true`），保证前端流程能继续（spec FR-017）。前端在 payload 见到 `degraded` 时显示轻提示。
