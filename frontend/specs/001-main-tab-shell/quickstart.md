# Quickstart: 自由对话主窗口与三 Tab 主框架 — 手动验证指南

**Branch**: `001-main-tab-shell`
**原型图基准**: `frontend/docs/mockups/自由对话主窗口_所有其他子功能布局根据这个来-不要参考子功能的布局.png`

前端无自动化测试框架，本文件为唯一验收手段。按顺序执行，全部通过即验收完成。

---

## 1. 前置条件

| 项 | 要求 | 检查方式 |
|----|------|---------|
| 讯飞凭据 | `backend/.env` 含 `XF_APP_ID` / `XF_API_KEY` / `XF_API_SECRET` | 文件存在且非空 |
| 后端依赖 | `uv sync`（含 dev 组 langgraph-cli） | `uv run langgraph --version` |
| 前端依赖 | `pnpm install` | `pnpm -C frontend -v` |
| 浏览器 | Chrome / Edge 最新版 | `getUserMedia` 需 localhost 或 HTTPS |

## 2. 启动

```bash
# 终端 1：后端（先起）
cd backend
uv run langgraph dev
# 期望: ─ Registering graph talk_agent ...  Server started at http://localhost:2024

# 终端 2：前端
cd frontend
pnpm dev
# 期望: Local: http://localhost:3000
```

**契约级自检（UI 之前）**：

```bash
curl -s -X POST http://localhost:2024/audio/transcribe -H "Content-Type: application/octet-stream" --data-binary "@src/talk_agent/test_resources/iat_pcm_16k.pcm"
# 期望: {"text":"..."}（非 404/500）

curl -s -X POST http://localhost:3000/api/audio/transcribe -H "Content-Type: application/octet-stream" --data-binary "@../backend/src/talk_agent/test_resources/iat_pcm_16k.pcm"
# 期望: 同上（验证 Next.js 代理链路）
```

## 3. 验收清单（对照 spec 用户故事）

### 故事 1：三 Tab 主框架（P1）

| # | 步骤 | 期望（对应验收场景） |
|---|------|---------------------|
| 1.1 | 打开 http://localhost:3000 | 默认进入第一个 Tab（主页面），底部三个 Tab 可见，第一个高亮（SC-001） |
| 1.2 | 点第 2 个 Tab | 显示占位内容，无报错；再点回第 1 个 Tab，**对话内容原样保留**（FR-003 / SC-003） |
| 1.3 | 反复切换 3 个 Tab 多次 | 无白屏、无 console 错误、无重复渲染（Edge Case：空 Tab 反复点击无副作用） |
| 1.4 | 观察布局 | 底部 TabBar、顶部栏、输入区位置与原型图一致（FR-005/FR-006） |

### 故事 2：现有对话能力迁移（P2）

| # | 步骤 | 期望 |
|---|------|------|
| 2.1 | Tab1 首屏 | 「新对话」按钮可见（NewDialogButton，迁移前行为） |
| 2.2 | 点击「新对话」 | coach 出话题（首轮空输入 run），停在 HITL（迁移前行为不变） |
| 2.3 | 在输入框输入文字发送 | 后端响应消息流式出现（含工具调用/Markdown 渲染与迁移前一致） |
| 2.4 | HITL 中断出现时回复 | InterruptPrompt 正常提交并恢复图（`respond` 路径） |
| 2.5 | 一轮跑到 END | AutoContinue 自动发起下一轮，循环对话延续 |
| 2.6 | 切到 Tab2 再切回 | 进行中的流/中断状态不丢失（provider 不卸载） |

### 故事 3：语音输入（P3 / FR-009）

| # | 步骤 | 期望 |
|---|------|------|
| 3.1 | 首次点击输入区麦克风按钮 | 浏览器弹麦克风授权；允许后按钮进入"录音中"态（红点/脉动等按原型图） |
| 3.2 | 单击开始 → 说一句话 → 再单击停止 | 单击-单击交互；停止后按钮显示"转写中…"态 |
| 3.3 | 等待转写 | ≤3s 文本**不经输入框停留直接发送**，作为用户消息出现并触发后端回复（SC-005） |
| 3.4 | 全程观察输入框 | 键盘输入功能始终可用；录音中途打字不冲突 |
| 3.5 | **失败兜底**：暂停后端（Ctrl+C langgraph dev）→ 再录一句 → 重启后端 | 轻提示"转写失败"类 toast，页面无跳转/白屏，键盘输入与 Tab 切换不受影响；重启后语音恢复 |
| 3.6 | 不说话立刻停止（<300ms） | 不发起请求，轻提示"未捕获到语音"类反馈 |
| 3.7 | （如可构造）http 非 localhost 环境打开 | 语音按钮置灰/提示，键盘输入正常（可选项） |

### UI 比对（Constitution 原则 IV，收尾必做）

| # | 步骤 | 期望 |
|---|------|------|
| U.1 | 主页面与原型图并排对比：主题色 | 主色（按钮/选中 Tab/高亮）一致，暗色模式（系统深色）同样协调（FR-006/SC-004） |
| U.2 | 圆角 | 消息气泡、输入框、按钮圆角与原型图一致 |
| U.3 | 输入框样式 | 背景、内边距、占位文案、语音/发送按钮排布与原型图一致 |
| U.4 | 顶部栏 | 布局元素齐全；无子功能支撑的元素**展示但点击无行为**（FR-010），不报错 |
| U.5 | 移动端宽度（DevTools 375px） | 布局不破版，TabBar 触控可用 |

## 4. Lint

```bash
cd frontend
pnpm lint        # oxlint + oxfmt --check，期望零错误
```

## 5. 常见问题

| 症状 | 原因 | 处理 |
|------|------|------|
| `/audio/transcribe` 404 | langgraph.json 未加 `http.app` 或后端未重启 | 检查配置后重启 `langgraph dev` |
| 转写 500 且 detail 含 auth | 讯飞凭据缺失/错误 | 核对 `backend/.env` |
| 麦克风灰色不可点 | 非 localhost/HTTPS 或未授权 | 地址栏授权；换 localhost 访问 |
| 对话无响应 | 后端未起 / `NEXT_PUBLIC_LANGGRAPH_ASSISTANT_ID` 与 langgraph.json 键名不符 | 核对 .env（应为 `talk_agent` 等实际 graph 键） |
