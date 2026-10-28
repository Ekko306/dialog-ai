# Data Model: 拓展润色气泡（005-polisher-bubble）

**Date**: 2026-10-27 | **Spec**: [spec.md](./spec.md) | **契约**: [contracts/polisher-message-contract.md](./contracts/polisher-message-contract.md)

## PolisherMessageData（前端消费结构）

```ts
interface PolisherMessageData {
  raw_text: string;        // 原句：原句行渲染 + 翻译输入 + raw 发音输入
  polished_text: string;   // 润色句：建议行渲染 + 复制/跟读/correct 发音输入
  explanation: string;     // 中文解释：本期不展示，字段保留（spec Assumptions）
  polish_status: string;   // 润色状态：success | fallback | skipped（降级判断输入）
}
```

**来源映射**（后端 polisher 字典 → 前端结构，透传时后端完成）：

| PolisherMessageData | 后端 state.polisher.* | 说明 |
|---|---|---|
| raw_text | original_text | 程序保存的原文（非模型副本） |
| polished_text | polished_text | 模型润色结果（成功）或原文（降级） |
| explanation | explanation | 模型中文解释 |
| polish_status | polish_status | success / fallback / skipped |

## 渲染决策状态机

```text
消息到达（AssistantMessage 分流）
  │
  ├─ correction_data 命中（003） ──→ 纠错气泡（零改动）
  │
  ├─ polisher_data 命中 或 state 关联命中
  │     │
  │     ├─ polished_text 非空 且 ≠ raw_text.trim() ──→ 润色气泡（FR-001）
  │     │
  │     └─ polished_text 为空 或 == raw_text.trim() ──→ 普通消息（FR-009 降级）
  │
  └─ 均未命中 ──→ 普通消息
```

**守卫规则**（parsePolisherData，与 003 parseCorrectionData 同款容错）：
- 非 object / polished_text 非 string → 返回 null（走普通消息，不报错）
- `polish_status === "skipped"` 视为无润色产出 → 不渲染气泡
- `polished_text.trim() === raw_text.trim()`（降级保留原文）→ 不渲染气泡
- raw_text / polished_text 为渲染必需；explanation / polish_status 允许缺省

## 组件数据流

```text
polisher-bubble.tsx
├── polisher-data.ts        parsePolisherData 守卫 + polisherCache(Map) + 类型
├── polisher-toolbar.tsx    文A → useTranslation(messageId, raw_text)【004 复用】
│                           AI发音 → useTtsButton(mid, "raw", raw_text, 伪条目)【003 复用】
│                           拓展润色 → 本地 useState（默认展开）
├── polisher-actions.tsx    AI发音 → useTtsButton(mid, "correct", raw_text, 伪条目)
│                           循环跟读 → CorrectionBubbleFollowAlong.useOpen()(mid, polished, raw, 伪条目)
│                           复制 → polished_text 写剪贴板（003 handleCopy 同款 + execCommand 兜底）
│                           收藏 → useHint 轻提示「功能开发中」
└── 评分条                  ScoreBar【003 复用】：润色分支 corrections=[]，仅发音项可渲染
```

**伪条目**（R1 决策，仅前端内存构造，不进任何契约存储）：

```ts
const polishAsCorrection: CorrectionInput = {
  wrong: data.raw_text,
  correct: data.polished_text,
  type: "polish",
};
```

## 后端改动数据流（唯一改动点）

```text
polisher_reply_message_node (talk_graph.py)
  读 state.polisher ──→ 正文 "\n".join(parts)【不变】
                    └─→ msg.additional_kwargs["metadata"]["polisher_data"] = {四字段}【新增】
                          ↓ 流式经 values 完整保留；非流式经 react-langchain 映射为 metadata.custom
```

## 状态字段边界

- `polisher` / `tutor_audio`：父图 OverAllState 既有字段，**不新增不修改**（原则 III）
- 前端不新增全局 store：跟读面板复用既有 zustand store；展开态/复制态为组件本地 state
- 翻译/音频缓存沿用 004/003 既有 Map（键隔离：翻译按 messageId，音频按 messageId:kind）
