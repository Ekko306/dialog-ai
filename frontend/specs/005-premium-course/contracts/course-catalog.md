# Contract: 课程目录查询

**Feature**: 005-premium-course | **Endpoint**: `GET /course/catalog`

前端经 `/api/course/catalog` 代理访问（现有 `app/api/[..._path]/route.ts` 已转发到 `127.0.0.1:2024`）。

## Request

```http
GET /course/catalog
```

无鉴权（单用户本机）、无查询参数。

## Response 200

```json
{
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
          "lesson_count": 3,
          "completed_count": 1,
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
                  "status": "completed"
                }
              ]
            }
          ]
        }
      ]
    }
  ],
  "summary": {
    "total_lessons": 3,
    "completed_lessons": 1
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `lesson_count` | number | 该课程课时总数（后端计算） |
| `completed_count` | number | 该课程已完成课时数（后端计算） |
| `lessons[].status` | `not_started` \| `in_progress` \| `completed` | 由进度文件合并得出 |

**说明**：目录接口一次性返回完整课程结构与进度，前端无需二次请求；课程内容不含练习题答案以外的敏感信息，`exercises[].reference_answer` 在目录中**不下发**（进入课时后由 session 接口按需给出）。

## Response 500

```json
{ "detail": "course data unavailable" }
```

课程文件缺失或 JSON 损坏时返回；前端展示错误态与重试按钮（spec Edge Cases）。
