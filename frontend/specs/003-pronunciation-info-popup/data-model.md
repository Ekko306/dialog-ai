# Data Model: 发音逐词分析信息弹窗（003-pronunciation-info-popup）

**原型图**：`frontend/docs/mockups/子功能-对话演示气泡-单击发音或地道-弹出更多信息弹窗.jpg`
**日期**：2026-10-27 ｜ **分支**：zzl-pure

> 本功能无数据库、无持久化实体；数据全部来自 LangGraph 线程 state 快照与按需 TTS。
> 实体分三层：后端 state 契约（两处最小扩展）、前端视图模型、前端内存态。

---

## 1. 后端 State 契约（既有 + 扩展）

### 1.1 `ise_check_results`（扩展：确定性字段透出）

位置：`backend/src/talk_agent/subgraphs/grammar_check_subgraph/ise_analyze_node.py`（`ise_analyze_node` 成功路径返回值）；声明于 `backend/src/talk_agent/state.py`（OverAllState / GrammarCheckState，`dict` 类型不变）。

```jsonc
{
  "pronunciation": [                      // 既有，不变
    { "word": "Recently", "score": 72.5, "comment": "…" }  // score 百分制 float|null
  ],
  "advice": "语速过慢，说快点听起来更舒服。…",   // 既有，不变（中文建议，可多句）
  "scores": {                             // ★新增：XML 解析结果原样透出，与 SC-004 一致
    "total": 70.0, "accuracy": 71.0, "fluency": 62.0, "integrity": 100.0
  },
  "speed_wpm": 78.0                       // ★新增：词/分；XML 无 time_len 时为 null
}
```

- 降级路径 `_degraded(reason)`：`pronunciation=[]`、`advice=原因`，新增字段缺省（前端按
  undefined 判空态），降级行为不变。
- 字段来源：`parse_ise_xml` 已解析的 `total/accuracy/fluency/integrity`（百分制）+
  `time_len`（新增读取，仅做除法推导，无业务逻辑变化）。

### 1.2 `PolisherOutput`（扩展：三风格可选字段）

位置：`backend/src/talk_agent/state.py:9-23`；写入方 `polisher_nodes.polisher_node`（续杯模式：每次返回完整 dict）。

```python
class PolisherOutput(TypedDict, total=False):
    # 既有 7 字段不变；polished_text/explanation = 地道美式（默认风格）
    original_text: str
    polished_text: str
    explanation: str
    polish_comment: str
    polished_audio: bytes
    polish_status: str        # success / fallback / failed / skipped
    tts_status: str
    # ★新增两个可选风格（Q1 决策 A：一次性生成；个别风格失败为 None 降级）
    style_business: dict | None   # {"polished_text": str, "explanation": str}（商务正式）
    style_british: dict | None    # {"polished_text": str, "explanation": str}（地道英式）
```

对应的 LLM 输出契约 `PolishResult`（`polisher_schema.py`）：

```python
class StylePolish(BaseModel):
    polished_text: str
    explanation: str

class PolishResult(BaseModel):
    original_text: str
    polished_text: str                                  # 地道美式（默认）
    explanation: str
    style_business: StylePolish | None = None           # ★新增
    style_british: StylePolish | None = None            # ★新增
```

### 1.3 既有只读字段（弹窗消费，零改动）

| Key | 类型 | 用途 |
|---|---|---|
| `ise_grade` | `float \| None` | 综合评分兜底（`scores.total` 缺失时） |
| `ref_text` | `str` | 英音/美音示范读音文本源；空则回退 `polisher.original_text` |
| `ise_status` | `str` | `ok` 之外 → 逐词分析/评分区块空态 |
| `audio_data` | `bytes` | 后端内部链路；弹窗不消费（"我的"走 R4 前端录音槽） |

---

## 2. 前端视图模型（派生，均在前端计算）

### 2.1 `WordMark` 逐词标注（R2 推导）

```ts
type WordQuality = "poor" | "fair" | "good";        // 待提高 / 小瑕疵 / 很完美
type WordExtra = "liaison" | "stress";              // 连读 / 重读词（可叠加）

interface WordMark {
  word: string;            // 原词（含标点还原：由原句按词切分对齐）
  quality: WordQuality | null;   // score 为 null → null（不标注）
  extras: WordExtra[];     // comment 关键词命中（"连读"/"重读"），默认 []
}
```

派生规则（常量文件，可调参）：
- `score < 60 → poor`；`60 ≤ score < 85 → fair`；`score ≥ 85 → good`
- `comment.includes("连读") → +liaison`；`comment.includes("重读") → +stress`

### 2.2 `ScorePanel` 评分建议

```ts
interface ScorePanel {
  total: number | null;        // scores.total ?? ise_grade ?? null
  fluency: number | null;      // scores.fluency
  accuracy: number | null;     // scores.accuracy（发音分）
  integrity: number | null;    // scores.integrity（完整度）
  speedWpm: number | null;     // speed_wpm（仪表盘；null → 空态）
  adviceLines: string[];       // advice 按句切分（。！？），逐条展示
}
```

语速仪表盘映射：量程 50→250 词/分（原型图刻度），指针角度线性映射并夹取到 [0,1]；
量程外数值仍显示真实数字（SC-004 不做四舍五入错位）。

### 2.3 `StylePolishView` 语境润色

```ts
type StyleKey = "american" | "business" | "british";   // 地道美式 / 商务正式 / 地道英式

interface StylePolishView {
  key: StyleKey;
  label: string;                 // Tab 文案（与原型图一致）
  polishedText: string | null;   // null → 该 Tab 空态（Edge Case：生成失败/缺失）
  explanation: string | null;
}
```

来源映射：`american ← polisher.polished_text/explanation`；`business ← polisher.style_business`；
`british ← polisher.style_british`。`polish_status === "fallback"|"failed"|"skipped"` 时
american 也置 null（空态）。

### 2.4 播放源

```ts
type PlaySource = "british" | "american" | "mine" | "polish";
```

- `british/american`：文本 = `ref_text || polisher.original_text`，经 `POST /audio/tts`
  按需合成（accent 参数区分）；文本为空 → 控件置灰。
- `mine`：最近一轮前端录音 PCM（内存槽）；无录音 → 置灰。
- `polish`（AI 朗读/循环跟读）：当前选中 Tab 的 `polishedText`；null → 置灰。

---

## 3. 前端内存态（会话级，不持久化）

| 槽 | 内容 | 生命周期 |
|---|---|---|
| 录音槽 | 最近一轮 Int16 PCM（16kHz/单声道）+ WAV Blob URL（懒创建） | 新录音覆盖；页面刷新清空 |
| 收藏集 | `Set<string>`（polishedText 为键） | 会话内存；刷新清空（spec Assumptions） |
| 弹窗 UI 态 | activeTab（默认 american）、播放状态、循环跟读开关 | 弹窗关闭即复位（FR-014） |

---

## 4. 实体关系与校验规则汇总

```
LangGraph OverAllState（快照）
├── ise_check_results ──派生──▶ WordMark[]（逐词区）+ ScorePanel（评分区）
├── ise_grade ────────兜底──▶ ScorePanel.total
├── ise_status ───────判定──▶ 空态分支（FR-015）
├── ref_text ─────────文本源──▶ /audio/tts（英音/美音/重读）
└── polisher ─────────映射──▶ StylePolishView[3]（润色区）+ /audio/tts（AI 朗读）
前端录音槽 ─────────────────▶ "我的"回放
```

校验规则（继承既有，无新增后端校验语义）：
- 后端润色三规则（长度比 0.5×~3×、英文≥3 字母、中文混入 ≤20%）按风格逐一套用，失败风格 → None。
- 前端不虚构数值：任何字段缺失一律空态/置灰，不填默认分（SC-006）。
