"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { Mic, Pause, Play, User, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { cn } from "cn";
import { FollowAlongScoring } from "@/components/follow-along-panel/follow-along-scoring";
import { RerecordBox } from "@/components/idiom-panel/rerecord-box";
import { useAudioPlayback } from "@/lib/audio-manager";
import { fetchEvaluation, EvaluationError, type EvaluationResult } from "@/lib/evaluation-client";
import { pcmToWavUrl } from "@/lib/pcm-wav";
import { getTtsAudioUrl, type CorrectionInput } from "@/lib/tts-client";
import { useHint } from "@/lib/use-hint";

/**
 * 循环跟读面板（US4 T013，FR-006~FR-009；验收基准为 spec US4/FR-006 文字描述，
 * 原型图未入库）。复用 002 已验证模式：@base-ui/react Dialog + tw-animate-css
 * 底部滑入 + zustand 跨组件状态。布局自上而下：标题栏 → 正确句全文 → 进度条 →
 * 播放/暂停 → 控制排（倍速/语言/循环）→ 麦克风占位。
 * 播放控制全部委托全局 audio-manager（FR-005 互斥；关闭面板不停声，data-model Entity 4）。
 */

interface FollowAlongPanelState {
  openMessageId: string | null;
  /** 面板展示文本：正确句（无则原句兜底，spec Edge Case） */
  text: string | null;
  /** TTS 旁路参数（合成正确句音频用） */
  rawText: string;
  corrections: CorrectionInput[];
  open: (messageId: string, text: string, rawText: string, corrections: CorrectionInput[]) => void;
  close: () => void;
}

const useFollowAlongStore = create<FollowAlongPanelState>((set) => ({
  openMessageId: null,
  text: null,
  rawText: "",
  corrections: [],
  open: (messageId, text, rawText, corrections) =>
    set({ openMessageId: messageId, text, rawText, corrections }),
  close: () => set({ openMessageId: null, text: null }),
}));

/**
 * 操作栏「循环跟读」入口 facade（US4 T014）：open(messageId, text, rawText, corrections)。
 */
export const CorrectionBubbleFollowAlong = {
  useOpen: () => useFollowAlongStore((s) => s.open),
};

const RATE_OPTIONS = [0.75, 1.0, 1.25] as const;

/** 语言标签（008 T007 US3）：示范播放仅美音（与 007 发音逐词分析拍板一致），单项化 */
const LANGUAGE_OPTIONS = [{ label: "英语(美)", available: true }] as const;

/** 跟读评测会话五态（008 data-model 状态机；会话仅存组件本地，不进 zustand/007 缓存） */
type FollowAlongPhase = "idle" | "recording" | "loading" | "ready" | "failed";

function formatTime(seconds: number): string {
  const s = Math.floor(seconds % 60);
  const m = Math.floor(seconds / 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function FollowAlongPanel() {
  const { openMessageId, text, rawText, corrections, close } = useFollowAlongStore();
  const messageId = openMessageId ?? "";
  const sourceId = `${messageId}:correct`;

  const audio = useAudioPlayback();
  const [hint, showHint] = useHint();
  // 首次合成进行中（T022）：audio-manager 无 loading 态，用局部 state 承载
  const [synthesizing, setSynthesizing] = useState(false);
  // ===== 008 跟读评测会话（US1/US2；contracts §1 红线：严禁写 evaluationCache/recordingStore） =====
  const [phase, setPhase] = useState<FollowAlongPhase>("idle");
  const [sessionPcm, setSessionPcm] = useState<ArrayBuffer | null>(null);
  const [evaluation, setEvaluation] = useState<EvaluationResult | null>(null);
  const [evalError, setEvalError] = useState("");
  // 「我的」回放（US2）：WAV URL 生命周期管理（新播前 revoke 旧 URL，卸载兜底回收）
  const mineUrlRef = useRef<string | null>(null);
  const mineSourceId = `${messageId}:follow-mine`;
  const isMineActive = audio.sourceId === mineSourceId;
  const isMinePlaying = isMineActive && audio.status === "playing";

  // 换消息 → 评测会话重置（R6；面板关闭即组件卸载自然清空，此处兜底 messageId 变化）
  useEffect(() => {
    setPhase("idle");
    setSessionPcm(null);
    setEvaluation(null);
    setEvalError("");
  }, [messageId]);

  // 卸载回收「我的」WAV URL
  useEffect(
    () => () => {
      if (mineUrlRef.current) URL.revokeObjectURL(mineUrlRef.current);
    },
    [],
  );

  /** 发起评测（FR-002/FR-003）：对照文本 = 跟读文本；失败统一 failed 态行内重试 */
  const requestEvaluation = async (pcm: ArrayBuffer) => {
    if (!text) return;
    setSessionPcm(pcm);
    setPhase("loading");
    try {
      const result = await fetchEvaluation(pcm, text);
      setEvaluation(result);
      setPhase("ready");
    } catch (err) {
      setEvalError(err instanceof EvaluationError ? err.message : "评测失败，请重试");
      setPhase("failed");
    }
  };

  /** 进入录音（FR-009）：暂停示范播放（不自动恢复）；重读入口同样走此路径 */
  const startRecording = () => {
    audio.pause();
    setPhase("recording");
  };

  /** 「我的」回放（US2 FR-006）：PCM→WAV 经全局 audio-manager 播放（互斥，research R3） */
  const handlePlayMine = async () => {
    if (!sessionPcm) return;
    if (isMinePlaying) {
      audio.pause();
      return;
    }
    if (mineUrlRef.current) URL.revokeObjectURL(mineUrlRef.current);
    const url = pcmToWavUrl(sessionPcm);
    mineUrlRef.current = url;
    try {
      await audio.play(mineSourceId, url);
    } catch {
      showHint("录音回放失败，请重试");
    }
  };

  const isActive = audio.sourceId === sourceId;
  const isPlaying = isActive && audio.status === "playing";
  const isPaused = isActive && audio.status === "paused";
  const isLoading = synthesizing || (isActive && audio.status === "loading");

  const handleTogglePlay = async () => {
    if (synthesizing) return; // 合成等待期重复点击不重复发起（spec Edge Case）
    if (isPlaying) {
      audio.pause();
      return;
    }
    if (isPaused) {
      audio.resume();
      return;
    }
    // idle：确保音频已合成再播（可能从未点过发音按钮）
    setSynthesizing(true);
    try {
      const url = await getTtsAudioUrl(messageId, "correct", rawText, corrections);
      if (!url) {
        showHint("语音合成失败，请稍后重试");
        return;
      }
      await audio.play(sourceId, url);
    } catch {
      showHint("语音合成失败，请稍后重试");
    } finally {
      setSynthesizing(false);
    }
  };

  const progress = audio.duration > 0 ? (audio.currentTime / audio.duration) * 100 : 0;

  return (
    <DialogPrimitive.Root
      open={openMessageId !== null}
      onOpenChange={(o) => {
        if (!o) close();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop
          className="fixed inset-0 isolate z-50 bg-black/40 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
          aria-hidden
        />
        <DialogPrimitive.Popup
          className={cn(
            "bg-secondary text-popover-foreground fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[85dvh] w-full max-w-[44rem] flex-col rounded-t-3xl shadow-lg outline-none duration-200",
            "data-open:animate-in data-open:slide-in-from-bottom data-closed:animate-out data-closed:slide-out-to-bottom",
          )}
        >
          {/* 标题栏：左标题右关闭×（FR-006；关闭不停声） */}
          <div className="flex shrink-0 items-center justify-between px-5 pt-5 pb-2">
            <DialogPrimitive.Title className="text-base font-semibold">
              循环跟读
            </DialogPrimitive.Title>
            <DialogPrimitive.Close
              aria-label="关闭"
              className="text-muted-foreground hover:text-foreground flex size-8 cursor-pointer items-center justify-center rounded-full transition-colors"
            >
              <X className="size-4.5" />
            </DialogPrimitive.Close>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pb-6">
            {/* 正确句全文（极长句可滚动，spec Edge Case）；
                008：recording/ready 态由录音区/评分视图自带参考句，隐藏避免重复 */}
            {(phase === "idle" || phase === "loading" || phase === "failed") && (
              <p className="text-foreground max-h-32 overflow-y-auto text-lg leading-relaxed font-medium wrap-break-word">
                {text}
              </p>
            )}

            {/* 进度条 + 时间（读全局 audio-manager） */}
            <div className="flex items-center gap-3">
              <div className="bg-muted relative h-1.5 flex-1 overflow-hidden rounded-full">
                <div
                  className="bg-primary absolute inset-y-0 start-0 rounded-full transition-[width] duration-150"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                {formatTime(audio.currentTime)} / {formatTime(audio.duration)}
              </span>
            </div>

            {/* 圆形播放/暂停键 + 「我的」录音回放（008 T006 US2；无录音时禁用） */}
            <div className="flex items-center justify-center gap-4">
              <button
                type="button"
                onClick={() => void handleTogglePlay()}
                aria-label={isPlaying ? "暂停" : "播放"}
                className="bg-primary text-primary-foreground flex size-14 cursor-pointer items-center justify-center rounded-full shadow-md transition-transform hover:scale-105 active:scale-95"
              >
                {isLoading ? (
                  <span className="size-5 animate-pulse rounded-full bg-current" aria-hidden />
                ) : isPlaying ? (
                  <Pause className="size-6" aria-hidden />
                ) : (
                  <Play className="size-6 translate-x-0.5" aria-hidden />
                )}
              </button>
              <button
                type="button"
                onClick={() => void handlePlayMine()}
                disabled={!sessionPcm}
                aria-label={isMinePlaying ? "暂停我的录音" : "播放我的录音"}
                title={sessionPcm ? "播放我的录音" : "完成一次跟读录音后可用"}
                className="border-primary text-primary flex size-10 cursor-pointer items-center justify-center rounded-full border-2 transition-colors hover:bg-primary/10 disabled:cursor-not-allowed disabled:border-black/15 disabled:text-muted-foreground/40"
              >
                {isMineActive && audio.status === "loading" ? (
                  <span className="size-3.5 animate-pulse rounded-full bg-current" aria-hidden />
                ) : isMinePlaying ? (
                  <Pause className="size-4.5" aria-hidden />
                ) : (
                  <User className="size-4.5" aria-hidden />
                )}
              </button>
            </div>

            {/* 控制排：倍速 / 语言 / 循环（FR-007/FR-009/FR-008） */}
            <div className="flex items-center justify-between gap-3">
              <div
                className="bg-background flex rounded-full p-0.5 shadow-sm"
                role="group"
                aria-label="倍速"
              >
                {RATE_OPTIONS.map((rate) => (
                  <button
                    key={rate}
                    type="button"
                    onClick={() => audio.setRate(rate)}
                    aria-pressed={audio.rate === rate}
                    className={cn(
                      "cursor-pointer rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
                      audio.rate === rate
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {rate}x
                  </button>
                ))}
              </div>

              <div
                className="bg-background flex rounded-full p-0.5 shadow-sm"
                role="group"
                aria-label="语言"
              >
                {LANGUAGE_OPTIONS.map((lang) => (
                  <button
                    key={lang.label}
                    type="button"
                    disabled={!lang.available}
                    title={lang.available ? undefined : "暂不支持"}
                    className={cn(
                      "rounded-full px-2.5 py-1 text-xs font-medium",
                      lang.available
                        ? "bg-primary text-primary-foreground cursor-pointer"
                        : "text-muted-foreground/50 cursor-not-allowed",
                    )}
                  >
                    {lang.label}
                  </button>
                ))}
              </div>

              {/* 循环开/关 */}
              <button
                type="button"
                onClick={() => audio.setLoop(!audio.loop)}
                aria-pressed={audio.loop}
                className={cn(
                  "bg-background flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium shadow-sm transition-colors",
                  audio.loop ? "text-primary" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span
                  className={cn(
                    "flex h-3.5 w-6 items-center rounded-full p-0.5 transition-colors",
                    audio.loop ? "bg-primary" : "bg-muted-foreground/40",
                  )}
                  aria-hidden
                >
                  <span
                    className={cn(
                      "size-2.5 rounded-full bg-white transition-transform",
                      audio.loop && "translate-x-2.5",
                    )}
                  />
                </span>
                循环{audio.loop ? "开" : "关"}
              </button>
            </div>

            {/* ===== 008 跟读评测区（五态状态机，US1/US2；FR-001~FR-006/FR-009/FR-010） ===== */}
            {phase === "idle" && (
              <div className="flex flex-col items-center gap-1.5 pt-1">
                <button
                  type="button"
                  onClick={startRecording}
                  aria-label="开始跟读录音"
                  className="border-primary text-primary flex size-12 cursor-pointer items-center justify-center rounded-full border-2 transition-colors hover:bg-primary/10"
                >
                  <Mic className="size-5" aria-hidden />
                </button>
                <span className="text-muted-foreground text-xs">
                  {hint ?? "点击麦克风，开始跟读"}
                </span>
              </div>
            )}
            {phase === "recording" && (
              /* 录音操作区复用 007 RerecordBox（research R2）：权限/过短/取消均已内建；
                 取消回到评测前状态（已有结果回评分视图，否则 idle） */
              <RerecordBox
                refText={text ?? ""}
                onRecorded={(pcm) => void requestEvaluation(pcm)}
                onCancel={() => setPhase(evaluation ? "ready" : "idle")}
              />
            )}
            {phase === "loading" && (
              /* 评测进行中反馈（FR-003），约 1~2s（quickstart §1） */
              <p className="text-muted-foreground flex items-center justify-center gap-1.5 pt-4 text-sm">
                <span className="inline-block size-1.5 animate-pulse rounded-full bg-current" />
                评测中…
              </p>
            )}
            {phase === "failed" && (
              /* 失败行内重试（FR-003/FR-010）：重发同一段录音，不要求重新录 */
              <div className="pt-2 text-center">
                <p className="text-sm text-red-500">{evalError}</p>
                <button
                  type="button"
                  disabled={!sessionPcm}
                  onClick={() => {
                    if (sessionPcm) void requestEvaluation(sessionPcm);
                  }}
                  className="text-muted-foreground hover:text-foreground mt-1.5 cursor-pointer text-sm disabled:opacity-50"
                >
                  重新评测
                </button>
              </div>
            )}
            {phase === "ready" && evaluation && (
              /* 评分视图（FR-004）：逐词着色句 + ScoreAdviceSection；重读经 onRerecord（US2） */
              <FollowAlongScoring result={evaluation} onRerecord={startRecording} />
            )}
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
