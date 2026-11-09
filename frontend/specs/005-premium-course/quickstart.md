# Quickstart: 精品课（精讲课对话）

**Feature**: 005-premium-course | **Date**: 2026-11-06

用于端到端验证本特性。契约细节见 [contracts/](./contracts/)，数据结构见 [data-model.md](./data-model.md)。

## 前置条件

```powershell
# 1. 后端依赖与密钥（backend/.env 已有 DEEPSEEK_API_KEY / XF_*）
cd e:\dialog-ai-main\backend

# 2. 启动后端（2024）
.\.venv\Scripts\langgraph.exe dev --no-browser

# 3. 另开终端启动前端（3000）
cd e:\dialog-ai-main\frontend
pnpm dev
```

健康检查：`http://127.0.0.1:2024/ok` 返回 `{"ok":true}`。

## 验证 1 - 课程目录接口

```powershell
curl.exe -s http://127.0.0.1:2024/course/catalog
```

**期望**：返回 `categories[].courses[].chapters[].lessons[]`，每个 lesson 带 `status`；
`summary.total_lessons` 等于预置课时总数。首次运行全部为 `not_started`。

## 验证 2 - 开始课时（拿到第一个环节）

```powershell
curl.exe -s -X POST http://127.0.0.1:2024/course/lesson/start `
  -H "Content-Type: application/json" `
  -d '{\"lesson_id\":\"mood-today-l1\"}'
```

**期望**：`stage = "intro"`，`payload` 含 `scene`、`target_sentence`，`resumed = false`。

## 验证 3 - 跟读推进（三步）

```powershell
# 3.1 错误输入 → 应返回 intro + feedback + attempts=1
curl.exe -s -X POST http://127.0.0.1:2024/course/lesson/step -H "Content-Type: application/json" -d '{\"session_id\":\"local:mood-today-l1\",\"input\":\"I am happy\"}'

# 3.2 正确输入（忽略大小写/标点）→ 应进入 knowledge
curl.exe -s -X POST http://127.0.0.1:2024/course/lesson/step -H "Content-Type: application/json" -d '{\"session_id\":\"local:mood-today-l1\",\"input\":\"im in a really good mood today\"}'

# 3.3 知识点 → 下一步 → exercise
curl.exe -s -X POST http://127.0.0.1:2024/course/lesson/step -H "Content-Type: application/json" -d '{\"session_id\":\"local:mood-today-l1\",\"input\":\"next\"}'
```

**期望**：3.1 不推进且 `attempts` 递增；3.2 `stage = "knowledge"`；3.3 `stage = "exercise"`。

## 验证 4 - 练习 / 角色扮演 / 总结

```powershell
# 4.1 作答（语义正确即可通过，措辞不必与参考答案一致）
curl.exe -s -X POST http://127.0.0.1:2024/course/lesson/step -H "Content-Type: application/json" -d '{\"session_id\":\"local:mood-today-l1\",\"input\":\"I am in a good mood today.\"}'

# 4.2 角色扮演一轮
curl.exe -s -X POST http://127.0.0.1:2024/course/lesson/step -H "Content-Type: application/json" -d '{\"session_id\":\"local:mood-today-l1\",\"input\":\"I got a new job!\"}'

# 4.3 走完剩余轮次后提交 done
curl.exe -s -X POST http://127.0.0.1:2024/course/lesson/step -H "Content-Type: application/json" -d '{\"session_id\":\"local:mood-today-l1\",\"input\":\"done\"}'
```

**期望**：依次走到 `roleplay` → `summary` → `completed`；`done: true` 时
`backend/src/course_agent/data/progress.json` 中该课时 `status = "completed"`。

## 验证 5 - 前端页面

1. 打开 `http://localhost:3000`，点底部第二个 Tab"精讲课对话"
2. 看到分类分组与课程卡片（不再是"功能建设中"）
3. 点课程卡片 → 详情页列出章节与课时，课时带完成状态
4. 点课时 → 进入独立全屏学习页，依次完成五个环节
5. 核心句旁有播放按钮，点击能听到英文朗读（走 `/audio/tts`）
6. 走完后返回详情页，该课时变为已完成，卡片进度 +1

## 验证 6 - 进度与续学

1. 在练习环节中途关闭页面，重新进入该课时
2. **期望**：直接从 `exercise` 环节继续，不重复跟读与知识点
3. 刷新页面后，已完成课时状态仍在（读 `progress.json`）

## 验证 7 - 降级

临时把 `backend/.env` 的 `DEEPSEEK_API_KEY` 改错并重启后端，重复验证 4：

**期望**：练习/角色扮演/总结返回 `degraded: true` 的兜底 payload，流程仍能走到 `completed`，
不出现 5xx 或页面卡死。

## 自动化检查

```powershell
# 后端单测（不依赖 API key）
cd e:\dialog-ai-main\backend
$env:PYTHONUTF8="1"; $env:PYTHONPATH="e:\dialog-ai-main\backend"
.\.venv\Scripts\python.exe -m pytest tests\unit_tests\test_text_match.py tests\unit_tests\test_course_repository.py tests\unit_tests\test_progress_repository.py -q

# 前端单测
cd e:\dialog-ai-main\frontend
pnpm vitest run lib/course-store.test.ts lib/course-api.test.ts
```
