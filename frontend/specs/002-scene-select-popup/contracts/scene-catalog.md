# Contract: 场景目录静态数据（scene-catalog）

**Branch**: `002-scene-select-popup` | **Spec**: [spec.md](./spec.md) | **原型图**: `frontend/docs/mockups/子功能-语音工具-选场景弹出弹窗.png`

前端内部数据契约（FR-011）：弹窗分类栏与话题卡片的唯一数据源。纯前端静态 TS 文件，无网络请求、无后端接口。

## 1. 文件与导出

- 文件：`frontend/lib/scene-catalog.ts`
- 导出：

```ts
export type CategoryId = "hot" | "today" | "daily" | "travel" | "career";

export interface SceneCategory {
  id: CategoryId;
  label: string;   // 分类胶囊文案
  order: number;   // 展示排序（原型图从左到右）
}

export interface SceneCatalogEntry {
  id: string;        // 目录内唯一，React key
  category: CategoryId;
  emoji: string;     // 卡片图标
  nameZh: string;    // 中文话题名（非空）
  nameEn?: string;   // 英文名（可缺省，缺省只显示中文）
  role: string;      // 后端角色（不含 "::"）
  scenario: string;  // 后端场景（不含 "::"）
}

export const SCENE_CATEGORIES: SceneCategory[];
export const SCENE_CATALOG: SceneCatalogEntry[];
```

## 2. 初始数据集（clarify 决策④：原型图可见话题为初始集，其余合理拟定，用户可随时替换）

**原型图直接可见（热门分类 6 项，精确对齐）**：

| id | emoji | nameZh | nameEn | role | scenario |
|----|-------|--------|--------|------|----------|
| `hobby` | ✨ | 爱好 | hobby | 英语口语教练 | 爱好 |
| `job-interview` | 💻 | 求职面试 | Job Interview | 英语口语教练 | 求职面试 |
| `check-in` | ✈️ | 办理登机 | Check in | 英语口语教练 | 办理登机 |
| `asking-directions` | 🛣️ | 问路 | Asking for directions | 英语口语教练 | 问路 |
| `afternoon-tea` | 🥞 | 点下午茶 | Order afternoon tea | 英语口语教练 | 点下午茶 |
| `black-monday` | 🎒 | 黑色星期一 | Black Monday | 英语口语教练 | 黑色星期一 |

> 注：`afternoon-tea` / `black-monday` 两张卡片在原型图底部被裁切，中文名按英文名合理拟定，实现时以目视比对为准，用户可随时改静态数据。

**其余分类（实现时按主题拟定，数量 3~4 项/分类，可自由替换）**：

- `today`（今日话题）：如 天气与周末计划、最近看的剧、新闻热点聊聊
- `daily`（日常交流）：如 点餐、购物砍价、看医生、打电话
- `travel`（旅游出行）：如 酒店入住、地铁问路、退换货、租借充电宝
- `career`（职场）：如 商务英语教练/职场会议（复用后端既有组合）、自我介绍、汇报进度、同事闲聊

**映射规则**：默认 `role = "英语口语教练"`、`scenario = nameZh`；仅当主题与后端既有 `CONTEXT_SEQUENCE` 组合（雅思口语考官、商务英语教练/职场会议）匹配时才使用对应 role。所有条目 `scenario` MUST NOT 含 `::`（见 [scene-apply-command.md](./scene-apply-command.md) 分隔符约定）。

## 3. 消费方与展示规则

| 消费方 | 规则 |
|--------|------|
| 分类胶囊栏 | 按 `order` 渲染 5 个胶囊；默认选中 `hot`（FR-003） |
| 卡片网格 | 过滤 `entry.category === activeCategory`（hot = 精选子集，直接引用其他分类条目对象，不复制数据）；双列网格（FR-004） |
| 点击卡片 | 取该条目 `role`/`scenario` 写入 `pendingScene`（见 [scene-apply-command.md](./scene-apply-command.md)） |
| 空分类 | 过滤结果为空时展示空态提示（边界用例：不空白崩溃） |
| 缺图标/缺英文名 | emoji 渲染失败显示占位圆形；`nameEn` 缺省只显示中文名（边界用例） |

## 4. 不变量

- 数据为纯常量：无副作用、无请求、模块导入即用。
- 条目增删只改本文件，弹窗 UI 与应用逻辑零改动。
- `SCENE_CATEGORIES` 恒含 `hot` 且 `order` 最小（默认选中依赖）。
