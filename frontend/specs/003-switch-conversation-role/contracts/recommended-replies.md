# Contract: 推荐回复数据（recommended-replies）

**Branch**: `003-switch-conversation-role` | **Spec**: [spec.md](../spec.md) | **原型图**: `frontend/docs/mockups/子功能-切换对话role.png`（图1 主界面 AI 消息下方 chips、图3 开场白下方 chips）

推荐回复（chips）的两个数据来源契约：**来源 A 角色配置（本期实现）** 与 **来源 B 后端随回复返回（本期仅预留，前端已按 FR-010 降级）**。统一渲染模型：`{ label: string; text: string }`。

## 1. 来源 A：角色配置（首轮，随开场白展示）

- 载体：`RoleCatalogEntry.openingSuggestions`（见 [role-catalog.md](./role-catalog.md)），0~2 条。
- 展示位置：开场白气泡下方（角色页 Welcome 内）。
- 生命周期：线程空（无用户消息）期间展示；用户发出第一条消息后随 Welcome 卸载。
- 点击行为：`ThreadPrimitive.Suggestion send` → `text` 作为一条用户消息发送（FR-009），走标准 submit 通道。

## 2. 来源 B：后端 state key `suggestions`（对话进行中，预留契约）

> **本期后端零改动**。本节定义目标契约供后端后续实现；在此之前 `useLangChainState` 读取结果恒为空 → 不展示、不影响收发（FR-010 降级即默认态，UI 无空位残留）。

### 2.1 读取方式（前端，本期落地）

```ts
import { useLangChainState } from "@assistant-ui/react-langchain";

const replies = useLangChainState<{ label: string; text: string }[]>("suggestions", []);
// replies.length > 0 时在最后一条 assistant 气泡下方渲染 chips
```

官方能力依据：`/docs/runtimes/langchain` "Reading custom state keys" —— `useLangChainState<T>(key, defaultValue)` 镜像 `useStream().values[key]`，随流式 state 更新响应式变化。

### 2.2 后端契约（后续实现时遵守）

- state key：`suggestions`（OverAllState 新增字段，`Annotated[list[dict], LastValue]` 或团队既有约定形态）。
- 值形态：`[{ "label": "简单", "text": "..." }, { "label": "商务", "text": "..." }]`，0~2 条。
- 写入时机：coach/角色回复节点产出最终回复时写入**本轮**推荐；新一轮回复开始前可清空或直接覆盖。
- 生命周期语义：state 为**线程级最新值**——前端只在最后一条 assistant 消息下方渲染（线程空闲时）；历史消息不回溯显示各自当时的推荐（如需 per-message 历史，演进路径见 §4）。
- 失败/缺失：节点异常时字段留空数组或缺席 → 前端不展示（MUST NOT 阻塞消息收发，FR-010）。

### 2.3 前端渲染规则（两来源共用渲染器 `RecommendedReplies`）

| 规则 | 说明 |
|------|------|
| 视觉 | 白底圆角胶囊行，"标签前缀 + 文案"（对照图1/图3："简单: …"）；横向可容纳单行截断，多 chips 纵向堆叠 |
| 点击 | `ThreadPrimitive.Suggestion prompt={text} send`，`label` 不进入消息正文 |
| 隐藏条件 | 线程 `isRunning` 或存在挂起 interrupt（点击发送走 submit 通道，与 HITL respond 通道互斥）；`AuiIf` 条件渲染 |
| 空态 | 无数据不渲染任何占位（降级无痕） |

## 3. 适用范围

- `AssistantSuggestions` 插槽传入后，**主对话界面与角色对话页同样生效**（对照图1：主界面 AI 消息下亦有 chips）；来源 A 仅存在于角色页（配置驱动）。

## 4. 演进预留（非本期范围）

- **per-message 历史推荐**：如需"每条历史 AI 消息下方永远显示其当时的推荐"，应改为后端把推荐写入消息元数据（LangChain `additional_kwargs`/`metadata`，随消息持久化于 checkpointer），前端经 `useMessageMetadata` 读取。本契约的 state key 形态为 MVP 最短路径，两者不冲突（state key 可继续驱动"最新一轮"，元数据驱动"历史"）。
- 后端生成算法（何时给、给几条、风格划分）不属于本特性范围（spec Assumption）。
