# 契约: 循环跟读评分装配（008）

> 无新后端契约（后端零改动）。本文档定义**前端装配边界**：008 与 007 复用件的隔离红线、组件接口、事件流。

## 1. 缓存隔离红线（最高优先级约束）

| 007 设施 | 008 是否使用 | 说明 |
|---|---|---|
| `evaluationCache`（Map<messageId, EvaluationResult>） | ❌ 只读**不写、不读** | 007 语义 = 消息级最新评测（发音逐词分析面板打开即读）；008 写入会造成跟读结果泄漏到纠错气泡面板。008 用组件本地 state |
| `recordingStore`（Map<转写文本, PCM>） | ❌ 不使用 | 007 语义 = 语音输入消息的录音暂存；跟读录音生命周期 = 面板会话，本地持有 |
| TTS 缓存键 `${messageId}:correct` | ✅ **只读命中** | 跟读面板示范播放本就用该键（图一中央播放键）；跟读轮不新增 TTS 调用 |
| TTS 缓存键 `${messageId}:raw` / `:panel-polish` | ❌ 不触碰 | 分属纠错气泡/润色面板 |
| 新音频 sourceId | ✅ `${messageId}:follow-mine` | 「我的」回放专用，经 audio-manager 互斥；与上述缓存键无命名冲突 |

**判定**：008 完成后，纠错气泡「发音」面板展示的评测结果必须与跟读面板互不影响——这是零回归验收的硬检查点。

## 2. 评测调用契约（复用 007 HTTP 契约）

调用方式与 [007 contracts/evaluate-endpoint-contract.md](../../007-pronunciation-analysis/contracts/evaluate-endpoint-contract.md) 完全一致：

```ts
import { fetchEvaluation } from "@/lib/evaluation-client";
const result = await fetchEvaluation(pcm, refText); // refText = 跟读文本（store.text）
// EvaluationError.message 直接作为 failed 态文案（含评测被拒「读的内容与参考句不符」固定文案）
```

消费规则不变：`is_rejected === true` 或 `total === null` → failed 态展示重试。

## 3. 组件接口

### follow-along-scoring.tsx（新增，装配组件）

```tsx
interface FollowAlongScoringProps {
  result: EvaluationResult;      // 评测结果（ready 态必有）
  /** 「重读」回调 → 宿主切回 recording 态（新一轮覆盖） */
  onRerecord: () => void;
}
/** 布局：逐词着色句（wordToneClass + mr-2 间距 + flags 角标）
 *  → ScoreAdviceSection（徽章+三行分数条+虚线+评语+标题行重读）
 *  不渲染「美音」按钮与图例行（示范播放由面板中央键承担，图二布局） */
```

### follow-along-panel.tsx（宿主改造）

- 麦克风区状态化：`idle`=麦克风按钮 / `recording`=`<RerecordBox refText={text} onRecorded onCancel/>` / `loading`=评测中 / `ready`=`<FollowAlongScoring result onRerecord/>` / `failed`=错误+重新评测
- 示范标签栏：`LANGUAGE_OPTIONS` 删除英/中两项（US3）
- 录音开始前：`audio.pause()`（若示范播放中）；结束/取消不自动恢复（FR-009）
- 「我的」按钮（控制排新增）：无 `pcm` 时禁用；有则 `audio.play(`${messageId}:follow-mine`, pcmToWavUrl(pcm))`
- 面板关闭：本地会话随组件卸载销毁，无需显式清理钩子（R6）

### 事件流（一轮完整跟读）

```text
[用户] 点麦克风 → [宿主] audio.pause() + phase=recording
[用户] 朗读后点结束 → [RerecordBox] onRecorded(pcm) → [宿主] phase=loading, fetchEvaluation(pcm, text)
[评测端点] 1~2s 返回 → phase=ready（pcm/result 本地留存）
[用户] 重读 → 回到 recording；成功后 result 覆盖（SC-003）
[用户] 关面板 → 全部丢弃；重开从 idle 开始（US2 验收 3）
```

## 4. 零改动清单（实现时逐项核对）

- `backend/**` 全部文件
- `lib/evaluation-client.ts` / `lib/pcm-recorder.ts` / `lib/tts-client.ts`
- `components/idiom-panel/**`（仅 `wordToneClass` 加 `export` 关键字）
- `lib/audio-manager.ts`（新增 sourceId 走既有 API，不改实现）
- 对话线程数据流（LangGraph 状态、气泡组件渲染逻辑）
