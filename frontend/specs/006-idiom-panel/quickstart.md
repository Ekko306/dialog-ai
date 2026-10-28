# Quickstart: 语境润色弹窗（地道入口）人工验收指南

**Feature**: 006-idiom-panel | **原型图**: `frontend/docs/mockups/子功能-对话演示气泡-单击发音或地道-弹出更多信息弹窗.jpg`（语境润色区块）

## 启动

```powershell
pnpm dev:backend   # 终端 1（127.0.0.1:2024）
pnpm dev:frontend  # 终端 2（localhost:3000）
```

## §1 主链路：润色气泡地道入口（US1，P1）

1. 发一句语法正确、表达可优化的英文（如 `Recently, I am learning English.`）→ 润色气泡出现
2. 评分条新增「地道 / 更多语境 >」入口（无分数数字，FR-001）
3. 点击入口 → 底部弹出面板，仅含语境润色区块（FR-003）：
   - 区块标题 + 风格标签栏（地道美式高亮 / 商务正式 / 地道英式）
   - 操作行：循环跟读｜复制｜收藏｜AI 发音
   - 「优化后的句子」= You can also say 里那句 + 「修改解释」中文
4. 内容 1 秒内完整可见（SC-001），无加载态（FR-004）
5. 点 × 或遮罩关闭 → 再开 → 内容一致、无加载（FR-010 / US1 场景 3）

## §2 纠错气泡按需生成（US2，P2）

1. 发语法错误句（如 `I goes to school yesterday.`）→ 纠错气泡出现，评分条新增「地道 / 优化表达 >」入口
2. 点击入口 → 面板打开并显示加载反馈（US2 场景 1）→ 数秒内显示针对纠正句（`I went to school yesterday.`）的润色结果（场景 2）
3. 关闭再开 → 立即显示缓存结果、无加载、不重复请求（FR-007，场景 4；SC-003 循环 10 次验证）
4. 失败态验证（可选）：断开后端后点入口 → 失败文案 + 行内重试；恢复后端点重试 → 正常出结果（FR-006，场景 3）

## §3 弹窗操作行（US3，P3）

在 §1 的面板中逐项验证（全部作用于润色句）：
- 循环跟读 → 打开跟读面板，跟读对象为润色句
- 复制 → 剪贴板为润色句 + 对勾反馈 1.5s
- 收藏 → 「功能开发中」提示
- AI 发音 → 播报润色句（§1 润色面板与 005 操作栏同键缓存；§2 纠错面板首次点击有合成等待）
- 风格标签栏仅显示「地道美式」单项（2026-10-27 验收调整：商务正式/地道英式占位已删）

## §4 零回归（US3 / SC-004）

- 纠错气泡既有行为：语法纠错!! 列表、✅ 前缀、文A 翻译、发音（示范句）、跟读、评分条发音项——全部照旧
- 润色气泡既有行为：You can also say 行、操作栏、发音（润色句）、评分条语法正确项——全部照旧
- 无纠正句的边缘（可选）：极短或无错误输入 → 纠错气泡不出现 → 地道入口无从出现（Edge Case ①）
- 多消息隔离：同一会话两条纠错消息分别打开面板 → 内容各自独立（Edge Case ④）

## §5 契约直验（可选，curl）

```powershell
$body = '{"assistant_id":"polisher","input":{"raw_text":"I went to school yesterday."},"stream_mode":"values"}'
Invoke-RestMethod -Uri http://localhost:2024/runs/wait -Method Post -Body $body -ContentType "application/json" | ConvertTo-Json -Depth 5
```

预期：响应含 `polisher` 字典（`polish_status: "success"`、`polished_text` 为润色句、`tts_status: "skipped"`）。

## 目视比对

面板布局与原型图「语境润色」区块逐项对照：标题、三标签、操作行图标顺序、优化句排版、解释排版。不一致处以原型图为准（除非用户调整需求）。
