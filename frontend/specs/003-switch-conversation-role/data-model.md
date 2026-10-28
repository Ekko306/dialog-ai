# Data Model: 切换对话角色与推荐回复

**Branch**: `003-switch-conversation-role` | **Date**: 2026-10-26

原则声明（Constitution 原则 III）：**不改后端任何数据结构**。本功能后端零改动；新增实体全部为前端态（静态配置常量 + localStorage 元数据 + 视图状态）。推荐回复的后端预留字段仅以契约形式定义（[contracts/recommended-replies.md](./contracts/recommended-replies.md)），本期不实现。

---

## 一、复用实体（后端 LangGraph 侧 / 现有前端体系，只读，不修改）

| 实体 | 来源 | 本功能用途 |
|------|------|-----------|
| `Thread` / `Message` | LangGraph Server checkpointer（**每角色一条 thread**），经 `useStreamRuntime` 管理 | 角色独立会话的消息流；隔离性由 thread_id 天然保证，历史恢复由受控 `threadId` 挂载完成（research R1） |
| `Interrupt`（HITL） | `useLangChainInterruptState()` | 角色页同样停在 HITL 等输入；`InterruptPrompt` 原样复用（respond 协议） |
| `Run` | `useStream().submit` / `respond` | 角色页消息发送与 `AutoContinue` 续跑，行为不变 |
| `Composer` + `DictationAdapter` | thread.aui.tsx / server-dictation-adapter.ts | 角色页输入区与语音输入（FR-008），原样复用 |

## 二、新增实体（纯前端）

### 1. RoleCatalogEntry（角色配置项）—— `lib/role-catalog.ts`

静态模块级常量，12 项，完整契约见 [contracts/role-catalog.md](./contracts/role-catalog.md)。

```ts
interface RoleOpeningSuggestion {
  label: string;  // 语域风格标签，如 "简单" / "商务"
  text: string;   // 回复内容（点击后作为用户消息发送）
}

interface RoleCatalogEntry {
  id: string;            // 稳定标识（如 "alicia" / "lisa"），路由与存储 key
  name: string;          // 角色名称（FR-003 清单）
  avatar: RoleAvatar;    // 头像（图片路径 或 首字母+色），见下
  tagline: string;       // 身份介绍一句话（列表空态/详情可用的描述性文案）
  opening: string;       // 预置开场白（FR-006，配置数据非现场生成）
  openingSuggestions: RoleOpeningSuggestion[];  // 首轮推荐回复（FR-010 前半），MVP 固定 2 条
}

type RoleAvatar =
  | { kind: "image"; src: string }                       // public/avatars/*.png
  | { kind: "initial"; char: string; colorClass: string }; // 首字母圆形（MVP 内置形态）
```

- **约束**: `id` 全局唯一且作为 localStorage/路由 key（不可变更语义）；`opening` 非空；`openingSuggestions` 长度 0~2（0 = 该角色无首轮推荐，界面不留空位）。
- `id === "alicia"` 的条目标记主对话身份：消息列表照常展示，但点击 = 返回主对话视图（research R1/R2），不创建角色实例。

### 2. RoleThreadMeta（角色会话线程元数据）—— `lib/role-thread-store.ts`

zustand store + `persist` 中间件（localStorage key：`talkai-role-threads`）。每角色一条，仅存"列表展示所需的最小元数据"，**消息正文不在此存储**（真值在线程 checkpointer）。

```ts
interface RoleThreadMeta {
  roleId: string;
  threadId: string | null;        // LangGraph thread id；null = 尚未建线（从未发送过消息）
  // 语义修订（tasks.md T018 排障，2026-10-27）：后端图每轮收尾写 SystemMessage("")
  // 作气泡分隔符 → messages 最后一条恒为空系统消息；取值须从后往前取第一条非空文本
  // （lastPreviewText()，main-chat-page.tsx）
  lastPreview: string;            // 最后一条非空文本消息预览（≤60 字符截断；空线程时为空串）
  lastActivityAt: number | null;  // 最近活跃时间戳（ms）；null = 从未活跃
  unreadCount: number;            // 未读标记数（语义见下）
}

interface RoleThreadState {
  metas: Record<string, RoleThreadMeta>;  // key = roleId
  enterRole: (roleId: string) => void;    // 进入对话页：unreadCount 归零（FR-004）
  leaveRole: (snapshot: {
    roleId: string;
    threadId: string | null;
    lastPreview: string;                  // 空串 = 调用方未取到文本（join 未完成等）→ store 保留旧外显
    hasNewActivity: boolean;              // 离开时 isRunning / 有未消费新消息
  }) => void;                             // 离开对话页：写预览/时间戳，按需 unreadCount += 1
  setThreadId: (roleId: string, threadId: string) => void;  // onThreadId 落库
  // —— 以下 3 成员为 2026-10-27 人设防串台/失效自愈新增（tasks.md T018）——
  lastMainPersona: BackendPersona | null; // 主对话最近一次经弹窗应用的后端人设（类型见 §5）；null = 从未选过
  setLastMainPersona: (persona: BackendPersona) => void;  // scene-applier 应用成功后记录
  resetThread: (roleId: string) => void;  // 线程失效自愈：服务端无消息历史 → 重置为从未对话态
}
```

**未读语义（research R4 规则表）**：`unreadCount > 0` 仅表示"离开该会话时它还有未完结的动静"，用于消息页角标展示（FR-004）；进入即清零；不承诺离线消息精确条数。

**视图层派生（MessagesPage 渲染规则，不落库）**：
- 预览文案：`meta.lastPreview` 非空用它；否则（从未活跃）用 `catalog.opening` 截断摘要（spec Edge Case）。
- 时间戳：`lastActivityAt` 当天显示 HH:MM、非当天显示 MM-DD；null 显示 "—"。
- 排序：有 `lastActivityAt` 的降序在前；无记录的按 catalog 配置顺序垫底。
- 角标：`unreadCount > 0` 显示红色圆形数字角标（对照原型图 2）。

### 3. RecommendedReply（推荐回复项）

跨"配置来源"与"后端来源"的统一渲染模型（渲染器 `RecommendedReplies` 的 props 项）：

```ts
interface RecommendedReply {
  label: string;  // 风格标签："简单" / "商务" 等
  text: string;   // 发送内容
}
```

| 来源 | 产生时机 | 载体 |
|------|---------|------|
| 角色配置（FR-010 前半） | 静态常量 | `RoleCatalogEntry.openingSuggestions` |
| 后端随回复返回（FR-010 后半） | AI 回复时写入 state | 线程 state key `suggestions`（预留契约，本期后端不实现；前端 `useLangChainState("suggestions", [])` 读取，空/缺失 = 不展示不阻塞） |

契约细节与演进（per-message 元数据）见 [contracts/recommended-replies.md](./contracts/recommended-replies.md)。

### 4. ShellRoute（页面导航状态，纯内存）

`app/assistant.tsx` 的 `useState`，不持久化（刷新后回主界面，可接受）。

**实现修订（T012，架构）**：原设计属 MainTabShell —— 角色级 useStreamRuntime 不可嵌套在根 provider 内（nesting 检测降级 no-op → 绑定宿主线程串扰），且根 provider 卸载会连带销毁其内部托管的 useStream 实例，故 ShellRoute 状态上移至 `app/assistant.tsx`，角色树与根 provider 树**互斥兄弟渲染**（role 时根 provider 保留挂载、仅卸载 shell 内容）；MainTabShell 改为接收 `route/onRouteChange` props。

```ts
type ShellRoute =
  | { name: "tabs" }                       // 现有三 Tab 壳（TabBar 可见）
  | { name: "messages" }                   // 消息页（全屏，隐藏 TabBar）
  | { name: "role"; roleId: string };      // 角色对话页（全屏，隐藏 TabBar）
```

状态转移：`tabs --点击消息入口--> messages --点击角色(alicia)--> tabs`；`messages --点击角色(其他)--> role --返回--> messages`；`role/messages --返回--> tabs`（仅 messages 直达 tabs）。

### 5. BackendPersona（后端教练人设桥接）—— `lib/backend-persona.ts`

**实现修订（2026-10-27 人设串台修复，tasks.md T018）**：后端 talk_agent 的教练人设存全局单例 Store（coach_context.py 命名空间 `("coach_context",)` key `"current"`，跨线程共享），12 角色共用同一 graph 时任何页面写入的人设会被其他页面的新话题读到。前端映射桥接（用户选定方案，零后端改动）：

```ts
interface BackendPersona {
  role: string;      // 后端教练角色描述，如 "英语纠错官"
  scenario: string;  // 后端场景描述，如 "中文纠错润色陪练"
}

const MAIN_DEFAULT_PERSONA: BackendPersona;           // 主对话缺省：英语口语教练 / 日常闲聊（后端 DEFAULT 值）
const ROLE_PERSONAS: Record<string, BackendPersona>;  // 11 角色映射（alicia 除外——其人设跟随用户选场景，存 §2 lastMainPersona）
function ensureBackendPersona(apiUrl: string, persona: BackendPersona): Promise<void>;
```

- **写入时机**：角色页（RoleAssistant）/主对话页（MainChatPage）挂载时各写本页人设（双向防串台）；NewDialogButton 发起新 run 前 await 兜底（快速点击早于挂载写入完成的窗口）。
- **写入方式**：langgraph dev Store REST API（`PUT /store/items`，204），PUT 幂等 + 请求串行队列（最终态 = 最后一次写入）。
- **可靠性**：写入失败静默放弃（沿用 Store 旧值，行为同修复前，不阻塞交互）；langgraph dev 重启清内存 Store → 下次页面挂载自动重写（自愈）。

## 三、视图状态归属一览

| 状态 | 归属 | 生命周期 |
|------|------|---------|
| 根 runtime（Ella 主线程流状态） | app/assistant.tsx provider | 应用全程，永不卸载 |
| 角色 runtime（每角色一个实例） | app/assistant.tsx 挂载的 RoleAssistant provider（T012/T017 修订：与根 provider 兄弟互斥，不在 RoleChatPage 内嵌套） | 角色页挂载期间；切走卸载，run 服务端继续，切回 reattach（research R1） |
| ShellRoute | app/assistant.tsx useState（T012 上移，MainTabShell 改收 props） | 应用全程（内存） |
| activeTab（三 Tab） | MainTabShell useState（001 既有） | 同上 |
| RoleThreadMeta | zustand persist | localStorage 持久 |
| 角色人设映射（ROLE_PERSONAS）/主对话人设记录（lastMainPersona） | lib/backend-persona.ts 常量 / RoleThreadMeta store（§5/§2） | 静态 / localStorage 持久 |
| 角色配置 | 模块常量 | 静态 |

## 四、实体关系图（本功能视角）

```text
┌─ app/assistant.tsx（持有 ShellRoute useState，T012 上移）─────────────────┐
│                                                                          │
│  route=role 时两树互斥兄弟渲染（角色级 runtime 绝不嵌套根 provider 内）：  │
│                                                                          │
│  兄弟树 A：RoleAssistant（角色级 provider，根 provider 之外）             │
│    useStreamRuntime + unstable_threadListAdapter（T009 修订：受控        │
│    threadId 不被转发 → 挂载后 switchToThread 附着持久化线程；             │
│    onThreadIdChange → setThreadId 落库；挂载探测失效线程 → resetThread） │
│    └─ RoleChatPage                                                       │
│         ├─ Thread(components.Welcome = RoleOpening)                      │
│         │    大头像 + 开场白 + RecommendedReplies(配置来源)               │
│         ├─ AssistantSuggestions 插槽                                     │
│         │    └─ RecommendedReplies(useLangChainState 后端来源，           │
│         │       (分享给主/角色页)  降级为空)                              │
│         ├─ RoleStartButton / InterruptPrompt / AutoContinue              │
│         └─ enterRole/leaveRole → RoleThreadMeta 快照/清零                │
│                                                                          │
│  兄弟树 B：AssistantRuntimeProvider（根，永不卸载；role 时内容卸载）      │
│    根 useStreamRuntime ── Ella 主对话线程（= 列表 alicia 条目）          │
│    └─ MainTabShell (activeTab；route=role 时仅壳内容卸载)                │
│       route=tabs: MainChatPage（消息入口按钮） + TabBar                  │
│          NewDialogButton(挂载回写主对话人设 §5) / 选场景 /                │
│          InterruptPrompt / AutoContinue                                  │
│       route=messages: MessagesPage ── 读 RoleThreadMeta + RoleCatalog    │
│          │   列表项 = 头像/名称/预览派生/时间戳派生/未读角标              │
│          ├─ 点 alicia → route=tabs（回主对话）                            │
│          └─ 点其他 → route=role（挂载兄弟树 A）                           │
└──────────────────────────────────────────────────────────────────────────┘
```
