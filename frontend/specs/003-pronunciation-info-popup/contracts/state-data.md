# Contract: 弹窗消费的 LangGraph State 数据（前端 ← 后端 state 快照）

**原型图**：`frontend/docs/mockups/子功能-对话演示气泡-单击发音或地道-弹出更多信息弹窗.jpg`
**读取方式**：`useLangChainState<T>(key)`（`@assistant-ui/react-langchain`，经 `/api` 代理的
LangGraph values 流），弹窗打开时取当前快照，不订阅增量。
**后端改动范围**：仅两处字段透出（Constitution 原则 II 允许的最小适配）；图结构、节点逻辑零改动。

---

## 1. `ise_check_results`（object，可空）

### 1.1 成功路径（ise_analyze_node 成功）

```jsonc
{
  "pronunciation": [
    { "word": "Recently", "score": 72.5, "comment": "读得不错，注意卷舌音。" }
  ],
  "advice": "语速过慢，说快点听起来更舒服。停顿偏多，流利一点就能让表达更自然。",
  "scores":    { "total": 70.0, "accuracy": 71.0, "fluency": 62.0, "integrity": 100.0 },
  "speed_wpm": 78.0
}
```

| 字段 | 类型 | 约束 | 消费方 |
|---|---|---|---|
| `pronunciation` | `Array<{word: string, score: number\|null, comment: string}>` | score 为百分制（后端已归一化）；无逐词分为 `null`，禁止前端编造 | 逐词标注（阈值映射见 data-model §2.1） |
| `advice` | `string` | 中文，一句或多句（。分隔） | 建议列表（按句切分） |
| `scores` | `{total, accuracy, fluency, integrity}`，均为 `number` | 与评测 XML 数值完全一致（SC-004），百分制 | 综合徽章 + 三进度条 |
| `speed_wpm` | `number \| null` | 词/分；XML 无 time_len 时 `null` | 语速仪表盘 |

### 1.2 降级路径（无评测/解析失败/is_rejected/无 key）

```jsonc
{ "pronunciation": [], "advice": "本次无发音评测数据（ise_status=no_audio），跳过点评" }
```

- `scores`/`speed_wpm` 字段缺省（`undefined`）。前端判定：`pronunciation.length === 0` 或
  `ise_status !== "ok"` → 逐词区与评分区空态；`advice` 展示原因文本。

### 1.3 兜底链

- 综合评分：`scores.total ?? ise_grade ?? null`。
- 整个 key 为 `undefined`（历史轮次/新线程）→ 同降级路径。

---

## 2. `polisher`（object，PolisherOutput，可空）

```jsonc
{
  "original_text":  "Recently, I am learning English.",
  "polished_text":  "Actually, I've been learning English lately.",   // = 地道美式
  "explanation":    "整体说明：…\n主要修改：1. …",
  "polish_comment": "（同 explanation，兼容字段）",
  "polished_audio": "<bytes>",          // 主链产物，弹窗不消费
  "polish_status":  "success",          // success / fallback / failed / skipped
  "tts_status":     "success",
  "style_business": { "polished_text": "I have been studying English recently.", "explanation": "…" },
  "style_british":  { "polished_text": "I've been learning English of late.", "explanation": "…" }
}
```

| 字段 | 类型 | 约束 |
|---|---|---|
| `polished_text` / `explanation` | `string` | 地道美式（默认 Tab 数据源）；`polish_status !== "success"` 时视为不可用 |
| `style_business` / `style_british` | `{polished_text, explanation} \| null \| undefined` | 可选；`null/undefined/校验失败` → 对应 Tab 空态，不影响其他 Tab（Edge Case） |

前端 Tab 映射：

| Tab | 数据源 | 空态条件 |
|---|---|---|
| 地道美式（默认选中） | `polished_text` + `explanation` | `polish_status !== "success"` |
| 商务正式 | `style_business` | 字段为 null/undefined 或 `polished_text` 空 |
| 地道英式 | `style_british` | 同上 |

`original_text`：示范读音文本第二兜底源（`ref_text` 为空时）。

---

## 3. 其他只读 key

| Key | 类型 | 消费 |
|---|---|---|
| `ise_grade` | `number \| null` | 综合评分兜底 |
| `ref_text` | `string` | 英音/美音/↻重读示范文本源（第一优先） |
| `raw_text` | `string` | 示范读音第三兜底源（2026-11-02 实测补充：tutor 纠错轮次 polisher 不执行、ref_text 自证模式为空时，用本轮朗读转写做示范源，前端零后端改动覆盖全场景） |
| `ise_status` | `string` | `ok` 之外 → 空态判定 |

---

## 4. 兼容性约束（MUST）

1. 后端新增字段只增不改不删：`pronunciation/advice` 结构与既有消费方（如有）保持一致；
   `PolisherOutput` 既有 7 字段语义不变。
2. `polisher_node` 续杯契约不变：仍返回含全部字段的完整 dict，新增字段默认 `None`。
3. 前端对所有字段做可缺省处理（`?.` + 空态分支），任何字段缺失不得抛错、不得白屏（FR-015）。
4. 弹窗关闭不清空 state；弹窗内所有数据为只读派生，禁止反向写入 state。
