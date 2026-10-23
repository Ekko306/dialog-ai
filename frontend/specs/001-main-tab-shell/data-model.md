# Data Model: 自由对话主窗口与三 Tab 主框架

**Branch**: `001-main-tab-shell` | **Date**: 2026-10-21

原则声明（Constitution 原则 III）：**不改后端任何数据结构**。本功能新增实体仅存在于前端；后端仅新增一个无状态 HTTP 端点（无实体）。以下分"复用实体（只读展示）"与"新增实体（前端态）"两部分。

---

## 一、复用实体（后端 LangGraph 侧，只读，不修改）

| 实体 | 来源 | 本功能用途 |
|------|------|-----------|
| `Thread`（对话线程） | LangGraph Server checkpointer，经 `useStreamRuntime` 管理 | Tab1 主页面消息流；切 Tab 期间由 provider 保持，不销毁 |
| `Message`（消息，LangChain-alike） | graph state `messages` 键 | Thread 原样渲染（用户/助手气泡、工具调用、Markdown、reasoning） |
| `Interrupt`（HITL 中断） | `useLangChainInterruptState()` | InterruptPrompt 原样渲染与 `useLangChainRespond` 恢复 |
| `Run`（运行轮次） | `useStream().submit` / `respond` | NewDialogButton 首轮空输入、AutoContinue 到 END 自动续跑，行为不变 |

> 上表全部沿用 `components/thread.aui.tsx` / `interrupt-prompt.tsx` / `talk-flow.tsx` 现有读取展示逻辑，迁移不改代码行为。

## 二、新增实体（纯前端，随组件存在，不落库）

### 1. TabConfig（Tab 配置）

主框架底部导航的静态配置项，模块级常量。

```ts
type TabId = "chat" | "tab2" | "tab3";

interface TabConfig {
  id: TabId;          // 稳定标识，作激活态 key
  label: string;      // 文案，按原型图（如"对话"）
  icon: LucideIcon;   // lucide-react 图标，按原型图
}
```

- **约束**: 3 项固定顺序（chat 首位）；`tab2`/`tab3` 渲染 EmptyTab 占位页。
- **状态归属**: `MainTabShell` 的 `useState<TabId>` 持有 `activeTab`；切换仅改 state，不产生路由/存储副作用。

### 2. RecordingSessionState（录音会话状态，由 DictationAdapter 承载）

不新建类型——直接采用 assistant-ui 官方 `DictationAdapter` 契约（Constitution 原则 I），前端不自建状态机：

```ts
// 来自 @assistant-ui/react（官方定义，此处仅引用）
type Status =
  | { type: "starting" | "running" }
  | { type: "ended"; reason: "stopped" | "cancelled" | "error" };

type Result = { transcript: string; isFinal?: boolean };
```

- `ServerDictationAdapter`（新增文件）内部持有：`AudioContext(16kHz)`、`MediaStream`、AudioWorklet 节点、Int16 PCM 块缓冲；对外只暴露官方 Session 接口。
- UI 侧经 `s.composer.dictation`（runtime 状态）读取，不自建 zustand store。
- 转写成功 → `Result{transcript, isFinal:true}` → runtime 将文本 commit 进 composer → 自动发送逻辑触发；失败 → `ended/error` → 轻提示。

### 3. TranscribeResponse（转写响应，契约载体，无前端实体）

见 [contracts/audio-transcribe.md](./contracts/audio-transcribe.md)。前端仅解构 `{ text }`，不缓存、不入库——文本随即走 composer 发送流程，进入现有 Message 实体。

## 三、后端新增（无实体，无状态函数调用）

`POST /audio/transcribe`：请求体 PCM 字节 → `xfyun_iat_tool_by_audio_data(audio_data) -> str` → `{"text": str}`。无数据库读写、无 graph state 交互、无新增模型类。错误场景见契约错误码表。

## 四、实体关系图（本功能视角）

```text
┌─ MainTabShell (activeTab: TabId) ────────────────────────────┐
│  TabBar ← TabConfig[]（静态常量）                              │
│                                                              │
│  chat: MainChatPage ─ AssistantRuntimeProvider（切Tab不卸载）  │
│         ├─ Thread（读 Message/ToolCall/Reasoning，沿用）       │
│         ├─ InterruptPrompt（读 Interrupt → respond，沿用）     │
│         ├─ NewDialogButton / AutoContinue（submit，沿用）     │
│         └─ Composer ─ Dictate/StopDictation                   │
│                      └─ ServerDictationAdapter（官方契约）     │
│                            └─ PCM → POST /audio/transcribe    │
│                                 └→ {text} → composer → 自动发送│
│  tab2/tab3: EmptyTab（静态）                                   │
└──────────────────────────────────────────────────────────────┘
```
