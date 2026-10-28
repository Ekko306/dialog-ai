# Data Model: 子功能-对话演示气泡-语法纠错场景

**Date**: 2026-10-24 | **Spec**: [spec.md](./spec.md)

前端本地的数据实体与状态机。所有后端字段复用 `backend/src/talk_agent/state.py` 既有契约（CorrectionItem / tutor_reply / ise_grade / raw_audio / tutor_audio），前端不新造持久化结构。

---

## Entity 1: CorrectionMessageData（纠错消息数据）

一条 AI 消息携带的纠错数据，来自后端 `additional_kwargs.correction_data` 透传（见 contracts/correction-message-contract.md）。

| 字段 | 类型 | 来源（后端契约） | 说明 |
|---|---|---|---|
| `raw_text` | `string` | state.raw_text | 用户原句（气泡顶部原句行、原句发音文本） |
| `tutor_reply` | `string` | state.tutor_reply | 讲解文本（含分隔线/✅ 前缀格式，前端原样渲染） |
| `corrections` | `CorrectionItem[]` | state.corrections | 修正清单；`{wrong, correct, type}`；正确句取 `corrections[0].correct` |
| `ise_grade` | `number \| null` | state.ise_grade | 发音评测总分；null → 评分条发音项不展示 |
| `feedback` | `string \| null` | state.feedback | 后端点评（评分条语法项文案参考，可缺省） |

**校验/渲染规则**:
- `corrections` 为空数组 → ✅ 正确句行不展示；复制降级（复制原句或禁用+提示）；跟读面板以原句为播放文本（spec Edge Cases）
- `correction_data` 缺失或反序列化失败 → 该消息按普通气泡渲染，不报错

## Entity 2: AudioPlaybackState（全局音频播放状态，zustand）

全局唯一（audio-manager 单例的对外状态），满足 FR-005 全局互斥。

| 字段 | 类型 | 说明 |
|---|---|---|
| `sourceId` | `string \| null` | 当前播放源标识：`{messageId}:raw` / `{messageId}:correct` / `{messageId}:panel` |
| `status` | `'idle' \| 'loading' \| 'playing' \| 'paused'` | loading=合成中；按钮据此渲染加载/播放中态 |
| `blobUrl` | `string \| null` | 当前音频的 Blob URL（合成结果缓存于 tts-client 按句缓存表） |
| `rate` | `number` | 倍速（0.75/1.0/1.25），跟读面板可调 |
| `loop` | `boolean` | 循环开关（跟读面板） |
| `currentTime` / `duration` | `number` | 秒；timeupdate/loadedmetadata 同步（跟读面板进度条） |

**状态迁移**:
```
idle → loading（点击发音按钮，发起 TTS）
loading → playing（合成成功，audio.play()）
loading → idle（合成失败：提示可重试，FR-012）
playing ⇄ paused（暂停/继续）
playing/paused → loading（切换新源：先 stop 旧源，保证全局互斥）
```

## Entity 3: CorrectionBubbleUIState（气泡本地状态，React useState）

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `expanded` | `boolean` | `true` | 展开态/收起态（clarify 决议：默认展开） |
| `translationOpen` | `boolean` | `false` | 文A 翻译区域开关 |
| `copied` | `boolean` | `false` | 复制成功反馈（对勾，~1.5s 后还原） |
| `translateText` | `null` | — | 译文固定无数据（R4），仅渲染"暂无翻译"占位 |

## Entity 4: FollowAlongPanelState（跟读面板，zustand）

| 字段 | 类型 | 说明 |
|---|---|---|
| `openMessageId` | `string \| null` | 面板绑定的纠错气泡消息 id；null=关闭 |
| `text` | `string` | 面板全文（正确句；无正确句时为原句） |
| `rate` / `loop` | 继承 AudioPlaybackState | 面板控件直接操作全局音频状态 |

**规则**: 面板打开不中断对话（spec Edge Case）；关闭面板不自动停止播放（保持全局互斥即可）——若需"关面板即停声"在 tasks 验收时按 quickstart 步骤确认，默认不停止。

## Entity 5: ScoreBarDisplay（评分条展示模型，派生）

| 项 | 数据条件 | 展示 |
|---|---|---|
| 语法纠错 | `corrections.length > 0` | 「语法纠错!! 继续加油」（无箭头跳转，静态标签） |
| 发音 | `ise_grade != null` | 「发音 {ise_grade}  发音分析 >」（入口占位轻提示） |
| 地道 | 永不满足（后端无数据源，R5） | 不渲染 |

整体三项均无数据 → 评分条不渲染（spec FR-011）。

---

## 关系图（文字版）

```
AIMessage (assistant-ui)
 ├─ 无 correction_data → 普通气泡（现状不动）
 └─ 有 correction_data: CorrectionMessageData
     ├─ CorrectionBubbleUIState → 收起态(原句行+功能行) / 展开态(+讲解+✅正确句+操作栏)
     ├─ ScoreBarDisplay → 气泡下方评分条
     ├─ 点击发音 → tts-client（TTS 旁路 invoke）→ AudioPlaybackState（全局互斥）
     └─ 点击循环跟读 → FollowAlongPanelState → 面板控件 → AudioPlaybackState
```
