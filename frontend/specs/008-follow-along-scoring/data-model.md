# Data Model: 循环跟读录音评测（008）

> 零新后端结构；本章仅定义前端装配层的本地会话状态与工具格式。

## 实体

### FollowAlongEvalSession（跟读评测会话——组件本地 state，非全局）

面板打开期间的一次「录音→评测」会话。生命周期 = 跟读面板本次打开（Dialog unmount 即销毁）。

```ts
import type { EvaluationResult } from "@/lib/evaluation-client";

/** 面板内评测状态机（六态中 idle 为初始态） */
type FollowAlongPhase =
  | "idle"        // 未录音：显示麦克风按钮
  | "recording"   // 录音中：RerecordBox 覆盖麦克风区
  | "loading"     // 评测中：「评测中…」反馈
  | "ready"       // 评分就绪：评分视图（逐词着色句 + ScoreAdviceSection）
  | "failed";     // 评测失败：错误文案 + 重新评测（重发同一 PCM）

interface FollowAlongEvalSession {
  phase: FollowAlongPhase;
  /** 本轮用户录音（16kHz/16bit/单声道 Int16 PCM），「我的」回放与失败重试的数据源 */
  pcm: ArrayBuffer | null;
  /** 最新评测结果；重读成功后覆盖（spec FR-005/SC-003） */
  result: EvaluationResult | null;
  /** 失败文案（EvaluationError.message，含评测被拒固定文案） */
  error: string;
}
```

**状态迁移**：

```text
idle --点击麦克风--> recording --onRecorded(pcm)--> loading --成功--> ready
                     |                                └--失败----> failed --重新评测(同pcm)--> loading
                     └--onCancel/面板关闭--> idle
ready --点击重读--> recording（新一轮，成功后覆盖 result）
```

**红线**：不写入 `evaluationCache` / `recordingStore`（007 缓存），不产生 LangGraph 线程事件，不回写任何气泡（spec FR-008，research R1）。

### 跟读文本（复用既有 zustand store，零改动）

`useFollowAlongStore` 现有字段 `text`（正确句）/ `rawText` / `corrections` 即评测对照文本与 TTS 参数来源，本 feature 不改 store 结构。

## 工具格式

### PCM → WAV 封装（`lib/pcm-wav.ts`，新增）

「我的」回放用：44 字节标准 WAV 头 + 原始 Int16 PCM 直写。

```ts
/** Int16 PCM（16kHz/16bit/单声道）→ WAV Blob URL；调用方负责 revokeObjectURL */
export function pcmToWavUrl(pcm: ArrayBuffer, sampleRate = 16000): string;
```

- 头部字段：RIFF/WAVE、fmt(PCM=1)、nChannels=1、byteRate=sampleRate×2、blockAlign=2、bitsPerSample=16
- 数据段 = pcm 原样追加（Int16Array 小端，与采集端字节序一致）

### 复用类型（007，只读引用）

| 类型/函数 | 来源 | 用途 |
|---|---|---|
| `EvaluationResult` / `EvaluationWord` | `lib/evaluation-client.ts` | 评测结果结构（total/accuracy/fluency/integrity/words） |
| `fetchEvaluation(pcm, refText)` | 同上 | 按需评测（4xx/5xx/被拒统一 EvaluationError） |
| `startPcmRecording()` | `lib/pcm-recorder.ts` | 采集（RerecordBox 内部使用，008 不直调） |
| `RerecordBox` | `components/idiom-panel/rerecord-box.tsx` | 录音操作区 |
| `ScoreAdviceSection` / `wordToneClass`（需导出） | `components/idiom-panel/pronunciation-section.tsx` | 评分建议区块 + 逐词着色规则 |

**唯一对 007 文件的触碰**：`pronunciation-section.tsx` 的 `wordToneClass` 从模块私有改为 `export`（零逻辑改动，供 R4 装配复用）。
