# Data Model: 子功能-语音工具-选场景弹出弹窗

**Branch**: `002-scene-select-popup` | **Date**: 2026-10-23 | **Spec**: [spec.md](./spec.md)

**原型图（验收基准）**: `frontend/docs/mockups/子功能-语音工具-选场景弹出弹窗.png`

## 实体

### 1. SceneCatalogEntry（场景目录条目，前端新增，FR-011）

一张话题卡片的数据；来源：`frontend/lib/scene-catalog.ts` 静态 TS 常量（用户可随时替换）。

| 字段 | 类型 | 必填 | 说明 | 校验规则 |
|------|------|------|------|---------|
| `id` | `string` | ✅ | 稳定唯一标识（如 `"job-interview"`） | 目录内唯一；React key |
| `category` | `CategoryId` | ✅ | 所属分类 id | 必须命中 `CATEGORIES` 之一 |
| `emoji` | `string` | ✅ | 卡片图标（emoji 字符，如 `"💻"`） | 缺失/渲染失败降级为占位圆形（边界用例） |
| `nameZh` | `string` | ✅ | 中文话题名（如 `"求职面试"`） | 非空；同时作为默认 `scenario` 语义来源 |
| `nameEn` | `string` | ❌ | 英文名（如 `"Job Interview"`） | 缺失时卡片只显示中文名（边界用例） |
| `role` | `string` | ✅ | 映射的后端角色（写入 CoachContext.role） | 非空；默认 `"英语口语教练"` |
| `scenario` | `string` | ✅ | 映射的后端场景（写入 CoachContext.scenario） | 非空；不得包含 `"::"`（见契约分隔符约定） |

### 2. Category（分类，前端新增，FR-003）

分类胶囊栏选项；来源同上。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `CategoryId` | `"hot" \| "today" \| "daily" \| "travel" \| "career"` |
| `label` | `string` | 展示名：热门 / 今日话题 / 日常交流 / 旅游出行 / 职场 |
| `order` | `number` | 展示排序（按原型图从左到右） |

约束：`"hot"`（热门）恒为默认选中分类（clarify 决策③），其条目为其他分类条目的精选子集（引用同一 SceneCatalogEntry，不复制数据）。

### 3. CoachContext（教练上下文，后端既有，零改动）

`backend/src/talk_agent/context/coach_context.py`。场景选择的结果即设定该上下文。

| 字段 | 类型 | 说明 |
|------|------|------|
| `role` | `str \| None` | 角色；None = 本次未指定，沿用 Store/默认 |
| `scenario` | `str \| None` | 场景；同上 |

生命周期：`set_context_node` 收到 `_set_context_` 指令 → `save_context` 写入 Store（`_CONTEXT_NS=("coach_context",)`，key `"current"`）→ 下一轮 run 的 `store_resolve_node → resolve_context` 按"显式 context > Store > 默认"解析 → 写入 `OverAllState.role/scenario` → `coach_reply_node` 拼入教练 prompt。

与既有轮换的关系（clarify 决策①）：`_new_context_`（轮换下一个）与 `_set_context_`（弹窗指定）并存，均以 `save_context` 落 Store 为准，后写者生效。

### 4. SceneUiState（前端场景 UI 状态，前端新增，zustand）

`frontend/lib/scene-store.ts`；负责弹窗与 SceneApplier 两个组件树之间的跨组件状态。

| 字段 | 类型 | 说明 |
|------|------|------|
| `pendingScene` | `{ role: string; scenario: string } \| null` | 待应用场景。弹窗点击卡片时写入；SceneApplier 成功 respond 后清除 |
| `applyError` | `string \| null` | 最近一次应用失败的提示文案；toast 展示后可清除 |

**状态转移**：

```text
(null) --点击卡片--> pendingScene --respond成功--> (null，场景已生效于后端 Store)
pendingScene --respond失败--> applyError=提示 & pendingScene保留当前场景(清空pending)
applyError --toast关闭/下次打开弹窗--> (null)
```

持久化：**无**（内存态）。场景真值以后端 Store 为准；刷新后前端不感知，直到下一次选择（符合"直到用户再次选择其他场景"，FR-014）。

### 5. 弹窗瞬态（组件内部 useState，不进 zustand）

| 状态 | 初值 | 说明 |
|------|------|------|
| `activeCategory` | `"hot"` | 每次打开弹窗重置（Base UI Dialog 关闭即卸载内容）——clarify 决策③ |
| `selectedEntryId` | `null` | 每次打开重置，不标记当前生效场景——FR-003 |

## 关系图

```text
SceneSelectPopup ──点击卡片──> SceneUiState.pendingScene
SceneUiState.pendingScene ──respond("_set_context_::role::scenario")──> 后端 HITL_node
后端 HITL_node ──路由──> set_context_node ──save_context──> LangGraph Store
LangGraph Store ──下轮 resolve_context──> OverAllState.role/scenario ──> coach prompt
OverAllState.role/scenario <──useLangChainState 响应式读取── 前端验证/quickstart
```

## 后端既有结构引用（零改动对照）

- `OverAllState.role / scenario`（`backend/src/talk_agent/state.py`）——`str`，LastValue 语义，本期仅被 `set_context_node` 写入。
- `CONTEXT_SEQUENCE`（`backend/src/tools/text_tool/scene_tool.py`）——4 组轮换组合，保持不动；目录条目不必落入该数组。
