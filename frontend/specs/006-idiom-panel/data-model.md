# Data Model: 语境润色弹窗（地道入口）

**Feature**: 006-idiom-panel | **Date**: 2026-10-27

## 实体 1: IdiomPanelData（弹窗展示数据，前端视图层）

| 字段 | 类型 | 来源（润色气泡） | 来源（纠错气泡） | 说明 |
|------|------|----------------|----------------|------|
| `polishedText` | string | 005 `polisher_data.polished_text` | 旁路响应 `values.polisher.polished_text` | 优化后的英文句子 |
| `explanation` | string | 005 `polisher_data.explanation` | 旁路响应 `values.polisher.explanation` | 中文修改解释 |
| `contextRawText` | string | 005 `polisher_data.raw_text`（原句） | 003 `corrections[0].correct`（纠正句） | TTS 伪条目的 wrong 位；跟读对照句 |

约束：`polishedText` 非空才可打开弹窗；纠错气泡入口守卫 `corrections.length > 0`（FR-002）。

## 实体 2: 按需润色缓存（polisher-bypass-client 模块级 Map）

```ts
type OnDemandPolish = { polished_text: string; explanation: string };
const onDemandCache: Map<string, OnDemandPolish>;   // 键 = messageId
const panelAudioCache: Map<string, string>;          // 键 = `${messageId}:panel-polish`，值 = Blob URL
```

- 写入规则：旁路成功且 `polished_text` 非空才写 `onDemandCache`（失败不缓存，允许重试，FR-006/007）
- `panelAudioCache` 仅纠错气泡面板使用（R2 缓存键隔离）；润色气泡面板音频走 tts-client 既有键（同句命中）
- 生命周期：会话级内存，页面刷新即清（同 004 translationCache）

## 实体 3: 弹窗开合状态（各气泡组件本地 useState）

```ts
const [idiomOpen, setIdiomOpen] = useState(false);   // CorrectionBubble / PolisherBubble 各自持有
```

- 组件卸载（切会话/刷新历史）→ 状态消失 → 面板消失（Edge Case ⑥ 天然满足）
- 缓存独立于开合状态：生成期间关闭弹窗，请求照常完成并写缓存（Edge Case ②）

## 组件数据流

```text
[润色气泡] PolisherScoreBar ──onIdiomOpen──► PolisherBubble(idiomOpen=true)
                 │                              │
                 │                 IdiomPanel(portal) ◄── PolisherMessageData（005 缓存/双路径，即时）
                 │                              │
[纠错气泡] ScoreBar ──onIdiomOpen──► CorrectionBubble(idiomOpen=true)
                                                │
                                   IdiomPanel(portal) ◄── polisher-bypass-client
                                                              │ 按 messageId 查缓存
                                                              │ 未命中: POST /api/runs/wait
                                                              │   assistant_id: polisher
                                                              │   input {raw_text: 纠正句}
                                                              └► loading / 失败重试 / 成功展示
```

## 状态机（纠错气泡弹窗内容区）

```text
idle ──打开且缓存命中──► ready
idle ──打开且无缓存──► loading ──成功──► ready（写缓存）
                          │
                          └─失败──► failed ──重试──► loading
润色气泡面板：恒 ready（数据随消息透传，无 loading/failed 态）
```
