# Contract: 角色目录静态数据（role-catalog）

**Branch**: `003-switch-conversation-role` | **Spec**: [spec.md](../spec.md) | **原型图**: `frontend/docs/mockups/子功能-切换对话role.png`（图2 列表、图3 角色页）

前端内部数据契约：消息页会话列表与角色对话页的唯一数据源。纯前端静态 TS 文件，无网络请求、无后端接口（spec FR-003 / Assumption）。

## 1. 文件与导出

- 文件：`frontend/lib/role-catalog.ts`
- 导出：

```ts
export interface RoleOpeningSuggestion {
  label: string;  // 语域风格标签，如 "简单" / "商务"
  text: string;   // 回复内容（点击后作为用户消息原文发送）
}

export type RoleAvatar =
  | { kind: "image"; src: string }                          // public/ 下图片路径
  | { kind: "initial"; char: string; colorClass: string };  // 首字母圆形（Tailwind 色类）

export interface RoleCatalogEntry {
  id: string;            // 稳定标识，路由/存储 key（如 "lisa"）
  name: string;          // 角色名称（FR-003 清单原文）
  avatar: RoleAvatar;
  tagline: string;       // 身份介绍一句话
  opening: string;       // 预置开场白（FR-006）
  openingSuggestions: RoleOpeningSuggestion[];  // 首轮推荐回复，0~2 条
}

export const ROLE_CATALOG: RoleCatalogEntry[];   // 12 项
export const MAIN_ROLE_ID = "alicia";            // 主对话身份的 roleId（点击 = 返回主对话视图）
export function getRole(id: string): RoleCatalogEntry | undefined;
```

## 2. 初始数据集（12 角色，spec FR-003 清单为准；文案为初始拟定，用户可随时替换静态数据）

| id | name | opening（初始文案） | openingSuggestions |
|----|------|--------------------|--------------------|
| `alicia` | TalkAI助教Ella（2026-10-26 用户指令：英文名随主对话取 Ella、头衔随身份保留，id/主线程语义不变） | （主对话身份，开场白不用于角色页 Welcome；列表空态预览用其后端欢迎语摘要"你好呀～我是你的个性化语言学习助手…"） | —（MVP 空） |
| `lisa` | 英语纠错官Lisa | Hi, 我是Lisa。我会用中文对你发出的英语进行纠错及润色，再用英语维持对话，我们开始吧！What's new today?（**spec FR-006 原文，不得改动**） | 简单/商务 各 1 条（如 "Not much. I've just been busy with work lately."） |
| `ella` | 英语零基础外教Alicia（2026-10-26 用户指令：英文名互换、头衔随身份保留） | Are you tired today? ...（按身份拟定） | 简单/商务 各 1 条 |
| `sally` | 全英纠错官Sally | Hi, I'm Sally! 👋 Let's chat in English. Don't be afraid of mistakes…（按身份拟定） | 简单/商务 各 1 条 |
| `mira` | AI外教Mira | Hey! I'm Mira. ✌️ Ready to relax and have fun while learning English?（按身份拟定，参照图2 预览） | 简单/商务 各 1 条 |
| `zora` | 传译官Zora | 你的专属传译官（图2 预览原文）…（按身份拟定） | 简单/商务 各 1 条 |
| `david` | AI外教David | Hello there! I'm so glad to meet you. I'm yo…（图2 预览，补全为完整开场白） | 简单/商务 各 1 条 |
| `dylan` | 雅思考官Dylan | 按雅思考官身份拟定（英文开场 + 考试引导） | 简单/商务 各 1 条 |
| `luke` | 每日俚语分享官Luke | Yo, it's Luke here! What's the specific situa…（图2 预览，补全） | 简单/商务 各 1 条 |
| `fiona` | Fiona | 按身份拟定 | 简单/商务 各 1 条 |
| `piper` | Piper带你学短语固定搭配 | 按身份拟定 | 简单/商务 各 1 条 |
| `sarah` | 词根词缀记单词Sarah | 按身份拟定 | 简单/商务 各 1 条 |

> 注：除 `lisa`（spec 原文）与图 2 可见预览（alicia/luke/mira/zora/david/sally/ella）外，其余开场白为实现时合理拟定；所有文案用户可随时改本文件，UI 与逻辑零改动（002 scene-catalog 同策略）。

**头像（实现修订 2026-10-27）**：实际交付采用 `{ kind: "image", src: "/roles/<id>.jpg" }` 真实图片形态（12 张图位于 `frontend/public/roles/`）；原设计的 `initial` 首字母形态保留为消费方兜底分支（图片缺失/目录异常时按 `kind` 分支渲染，无逻辑改动）。

## 3. 消费方与展示规则

| 消费方 | 规则 |
|--------|------|
| MessagesPage 列表 | 按 `ROLE_CATALOG` 全量 12 项渲染 + role-thread-store 元数据派生（排序/预览/角标，见 data-model §2） |
| 列表项点击 | `id === MAIN_ROLE_ID` → 返回主对话视图；其他 → 进入 `route=role`（FR-005/FR-012） |
| RoleChatPage | `getRole(route.roleId)`；`undefined` 或字段缺失 → "该角色暂时无法使用" 空态（FR-011） |
| RoleOpening（Welcome） | 渲染 `avatar` 大图 + `opening` 气泡 + `openingSuggestions` chips（FR-006/FR-009） |
| 列表空态预览 | `opening` 截断（从未活跃角色，spec Edge Case） |

## 4. 不变量

- 数据为纯常量：无副作用、无请求、模块导入即用；条目增删改只动本文件。
- `id` 稳定：一经发布不得更改（localStorage 元数据与导航以其为 key）。
- `alicia` 恒存在且 `MAIN_ROLE_ID` 指向它（消息页第 5~6 位的展示位置由排序规则决定，不固定）。
- `opening` 非空字符串；`openingSuggestions.label` 非空（渲染为标签前缀）。
