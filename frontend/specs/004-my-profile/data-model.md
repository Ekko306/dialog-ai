# Data Model: 004 主窗口-我的（个人中心）

**Spec**: [spec.md](spec.md) | **Research**: [research.md](research.md) | **原型图**: `frontend/docs/mockups/子功能-主窗口-我的-个人中心.html`

全部实体均为前端视图层模型；后端数据结构零改动（仅只读消费既有 LangGraph state 快照字段）。

## 1. 后端只读数据源（既有，不改）

### 1.1 轮次快照字段（`POST /threads/{id}/history` 各检查点 `values`）

| 字段 | 类型 | 用途 | 缺失处理 |
|---|---|---|---|
| `ise_status` | `string` | `"ok"` 才计入有效朗读轮 | 非 ok / 缺失 → 跳过该轮 |
| `ise_check_results` | `IseCheckResults`（popup-store.ts L29-34） | 错词本原料 + 综合分 + 语速 | 缺失 → 跳过该轮 |
| `ise_check_results.scores.total` | `number \| null` | 平均综合分 / 趋势 | null 不计入均值 |
| `ise_check_results.speed_wpm` | `number \| null` | 平均语速 | null 不计入均值 |
| `ise_check_results.pronunciation[]` | `PronunciationItem { word, score, comment }` | 错词本逐词原料 | score=null 不计档位 |

复用常量（word-marks.ts，禁止复制）：`qualityOf`（<60 poor / 60-85 fair / ≥85 good）、`normalizeWord`（去标点小写，去重键）、`SILENCE_TOKENS`（过滤 sil/sp/pause）。

## 2. 前端视图模型（本功能新增）

### 2.1 `ProfileRound`（聚合最小轮次单元，lib/profile-aggregate.ts 内部）

```ts
interface ProfileRound {
  threadId: string;
  updatedAt: string;            // 快照时间，趋势排序用
  total: number | null;         // scores.total
  speedWpm: number | null;      // speed_wpm
  words: { word: string; quality: "poor" | "fair"; extras: string[] }[]; // 已过滤 sil / good
}
```

### 2.2 `ProfileSummary`（概览区块，US1）

```ts
interface ProfileSummary {
  roundCount: number;           // 累计朗读轮数（有效轮）
  avgTotal: number | null;      // 平均综合分，保留 1 位小数；无数据 → null → 展示 "--"
  avgSpeed: number | null;      // 平均语速（词/分），四舍五入取整；无数据 → null
  trend: { label: string; total: number }[];  // 最近 5 轮（时间正序），最多 5 根柱
}
```

### 2.3 `WeakWord`（错词本条目，US2）

```ts
interface WeakWord {
  key: string;                  // normalizeWord(word)
  word: string;                 // 首次出现时的展示词
  worstQuality: "poor" | "fair"; // 最差档（poor < fair，clarify Q2）
  count: number;                // 累计出现次数（各轮同一 key 累加）
  extras: string[];             // 出现过的连读/重读标注并集
}
// 排序：count 降序；同频次 worstQuality 差者在前（SC-004）
```

### 2.4 `FavoriteItem`（收藏，US3，favorites-store.ts）

```ts
interface FavoriteItem {
  key: string;                  // = 英文句子（polishedText），唯一键（沿用 003 键语义）
  style: string;                // 风格标签：american / business / british
  en: string;                   // 英文句子
  zh: string;                   // 中文解释
  savedAt: number;              // 收藏时间戳，列表按其倒序
}
```

生命周期：003 弹窗收藏（polish-section）与"我的"取消收藏共同读写同一 store → 双向同步（FR-009 / SC-006）。

### 2.5 `ProfileSettings`（设置，US4，lib/profile-settings.ts）

```ts
interface ProfileSettings {
  accent: "american" | "british";  // 默认口音，默认 "american"
  loopDefault: boolean;            // 循环跟读默认开启，默认 false
  ttsEnabled: boolean;             // TTS 语音输出开关，默认 true（关闭 → 自动应答 audio_choice interrupt 为 no，R6）
}
```

生命周期：设置页写入 → 持久化；三处发声入口 / use-popup-audio 初值 / interrupt 自动应答读取。改动即时生效（SC-005）。

## 3. 状态与加载态（US1 验收 2 / FR-013/014）

| 态 | 触发 | 展示 |
|---|---|---|
| loading | 聚合请求进行中 | 骨架屏（1s 内出现，SC-001） |
| empty | 有效轮次 = 0 | 统计卡 `--` + 引导文案；错词本空态文案（FR-013） |
| error | threads/history 请求失败 | 错误提示 + 重试按钮（FR-014），已加载部分保留展示 |
| ready | 聚合完成 | 四区块填充 |

localStorage 不可用 → 收藏/设置降级内存态（当前会话有效），UI 无感知（FR-012）。
