"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, Square, X } from "lucide-react";
import { startPcmRecording, type PcmRecorderHandle } from "@/lib/pcm-recorder";

/**
 * 重读录音操作区（007 T009，FR-006；spec US2）：
 * 面板内嵌录音区——开始 → 进行中反馈（脉冲点 + 秒数）→ 结束 → 将新 PCM 经
 * onRecorded 交回 IdiomPanel 触发重新评测；× 取消由 IdiomPanel 收起本组件
 * （回到重读前状态，无残留）。
 * Edge Case（spec）：权限被拒 / 设备不可用 → 明确提示 + 可重试可关闭；
 * 录音 <300ms → 提示过短，不发起评测（pcm-recorder stop 返回 null）。
 */

interface RerecordBoxProps {
  /** 参考文本（用户原句）——明确展示让用户知道重读什么 */
  refText: string;
  /** 录音确认结束（拿到有效 PCM）后回调 */
  onRecorded: (pcm: ArrayBuffer) => void;
  /** 用户取消重读（点 ×），回到重读前状态 */
  onCancel: () => void;
}

type RerecordPhase = "idle" | "starting" | "recording" | "error";

export function RerecordBox({ refText, onRecorded, onCancel }: RerecordBoxProps) {
  const [phase, setPhase] = useState<RerecordPhase>("idle");
  const [errorHint, setErrorHint] = useState("");
  const [seconds, setSeconds] = useState(0);
  const recorderRef = useRef<PcmRecorderHandle | null>(null);

  // 卸载兜底释放麦克风（正常路径 stop/cancel 已释放，幂等）
  useEffect(() => {
    return () => recorderRef.current?.cancel();
  }, []);

  // 录制中计时反馈
  useEffect(() => {
    if (phase !== "recording") return;
    const startedAt = Date.now();
    setSeconds(0);
    const timer = setInterval(() => {
      setSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 500);
    return () => clearInterval(timer);
  }, [phase]);

  const handleStart = () => {
    setErrorHint("");
    setPhase("starting");
    recorderRef.current?.cancel();
    recorderRef.current = startPcmRecording({
      onReady: () => setPhase("recording"),
      onError: () => {
        setPhase("error");
        setErrorHint("无法访问麦克风，请检查浏览器权限后重试");
      },
    });
  };

  const handleStop = async () => {
    const recorder = recorderRef.current;
    if (!recorder || phase === "starting") return;
    setPhase("starting"); // 防重复点击
    const result = await recorder.stop();
    recorderRef.current = null;
    if (result === null) {
      setPhase("error");
      setErrorHint("录音太短，请重新朗读");
      return;
    }
    onRecorded(result.pcm);
  };

  return (
    <div className="mt-3.5 rounded-xl border border-dashed border-black/15 p-3">
      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-xs">重读参考句</p>
        <button
          type="button"
          onClick={onCancel}
          aria-label="取消重读"
          className="text-muted-foreground hover:text-foreground cursor-pointer rounded-md p-0.5 transition-colors hover:bg-black/5"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </div>
      <p className="mt-1 text-sm leading-relaxed font-medium wrap-break-word">{refText}</p>

      <div className="mt-3 flex items-center gap-3">
        {phase !== "recording" ? (
          <button
            type="button"
            onClick={handleStart}
            disabled={phase === "starting"}
            aria-label="开始重读录音"
            className="flex cursor-pointer items-center gap-1 rounded-full bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Mic className="size-3.5" aria-hidden />
            {phase === "starting" ? "处理中…" : "开始录音"}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void handleStop()}
            aria-label="结束重读录音"
            className="flex cursor-pointer items-center gap-1 rounded-full bg-red-500 px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
          >
            <Square className="size-3.5" aria-hidden />
            结束录音{seconds > 0 ? ` (${seconds}s)` : ""}
          </button>
        )}
        {phase === "recording" && (
          <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <span className="inline-block size-1.5 animate-pulse rounded-full bg-red-500" />
            正在录音，请朗读参考句…
          </p>
        )}
      </div>

      {errorHint && <p className="mt-2 text-xs text-red-500">{errorHint}</p>}
    </div>
  );
}
