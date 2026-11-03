"use client";

import { RotateCw, Volume2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { getSettings } from "@/lib/profile-settings";

import { getLastRecording } from "@/components/server-dictation-adapter";
import type { PopupSnapshot } from "./popup-store";
import { type PopupAudioApi, ttsSourceKey } from "./use-popup-audio";
import { deriveWordMarks, type WordQuality } from "./word-marks";

/**
 * 逐词发音分析区块（US1，原型图第一卡）：五类图例 + 逐词着色 + 播放行。
 *
 * - 三档配色：待提高红 / 小瑕疵橙 / 很完美绿；连读绿色波浪下划线、重读词绿色粗下划线
 *   （叠加时波浪+粗下划线并存）；
 * - 播放行：英音/美音（示范文本 ref_text || polisher.original_text 经 /api/audio/tts）、
 *   "我的"（前端最近一轮录音回放）、右侧 ↻重读（重放最近一次示范合成）；
 * - 空态：pronunciation 为空或 ise_status !== "ok" → "本轮没有评测数据"（FR-003/015）；
 * - 文本源为空/无录音 → 对应控件置灰（FR-005/006/015）；错误外显不静默（FR-015）。
 */

const QUALITY_STYLES: Record<WordQuality, string> = {
  poor: "bg-red-500/10 text-red-500",
  fair: "bg-orange-500/10 text-orange-500",
  good: "bg-(--icon-brand-green)/10 text-(--icon-brand-green)",
};

interface WordAnalysisSectionProps {
  snapshot: PopupSnapshot;
  audio: PopupAudioApi;
}

export function WordAnalysisSection({ snapshot, audio }: WordAnalysisSectionProps) {
  const results = snapshot.ise_check_results;
  const empty = !results?.pronunciation?.length || snapshot.ise_status !== "ok";

  // 示范读音源兜底链：教练预设句 → 润色原句 → 本轮朗读转写。
  // tutor 纠错轮次 polisher 不执行，raw_text 是该轮唯一示范源（用户读的那句）
  const demoText =
    snapshot.ref_text?.trim() ||
    snapshot.polisher?.original_text?.trim() ||
    snapshot.raw_text?.trim() ||
    "";
  const demoTextOk = demoText.length > 0;
  const hasRecording = getLastRecording() !== null;

  const marks = empty ? [] : deriveWordMarks(results?.pronunciation, demoText);

  return (
    <section
      className="rounded-2xl bg-background p-4 shadow-sm"
      data-slot="pronunciation-word-analysis"
    >
      {/* 五类图例（原型图逐项：三色圆点 + 连读波浪线 + 重读词粗下划线） */}
      <div className="text-foreground/80 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-red-500" aria-hidden />
          待提高
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-orange-500" aria-hidden />
          小瑕疵
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-(--icon-brand-green)" aria-hidden />
          很完美
        </span>
        <span className="decoration-(--icon-brand-green) underline decoration-wavy decoration-2 underline-offset-[5px]">
          连读
        </span>
        <span className="border-(--icon-brand-green) border-b-[3px]">重读词</span>
      </div>

      {empty ? (
        <p className="text-muted-foreground py-8 text-center text-sm">本轮没有评测数据</p>
      ) : (
        <>
          {/* 逐词着色：长句自动换行，不溢出（Edge Cases） */}
          <p className="text-foreground mt-3 flex flex-wrap gap-x-1.5 gap-y-1 text-lg leading-relaxed">
            {marks.map((mark, index) => (
              <span
                key={`${mark.word}-${index}`}
                className={cn(
                  "rounded-md px-0.5",
                  mark.quality && QUALITY_STYLES[mark.quality],
                  mark.extras.includes("liaison") &&
                    "decoration-(--icon-brand-green) underline decoration-wavy decoration-2 underline-offset-[5px]",
                  mark.extras.includes("stress") && "border-(--icon-brand-green) border-b-[3px]",
                )}
              >
                {mark.word}
              </span>
            ))}
          </p>
        </>
      )}

      {/* 播放行：三个播放源 + ↻重读（原型图：虚线分隔，重读靠右绿色）。
          空态下仍渲染——"我的"录音回放不依赖评测数据（FR-005/006 无条件可用），
          英音/美音按文本源、我的按录音有无分别置灰 */}
      <div className="mt-4 flex items-center gap-5 border-t border-dashed border-black/10 pt-3">
        <PlayButton
          label="英音"
          disabled={!demoTextOk}
          active={audio.activeKey === ttsSourceKey("british", demoText)}
          onClick={() => audio.play({ kind: "tts", text: demoText, accent: "british" })}
        />
        <PlayButton
          label="美音"
          disabled={!demoTextOk}
          active={audio.activeKey === ttsSourceKey("american", demoText)}
          onClick={() => audio.play({ kind: "tts", text: demoText, accent: "american" })}
        />
        <PlayButton
          label="我的"
          disabled={!hasRecording}
          active={audio.activeKey === "recording"}
          onClick={() => audio.play({ kind: "recording" })}
        />
        <button
          type="button"
          onClick={() =>
            audio.replayLastDemo(
              // ↻重读 fallback accent 跟随设置默认口音（004 R4①，原硬编码 "american"）
              demoTextOk ? { kind: "tts", text: demoText, accent: getSettings().accent } : undefined,
            )
          }
          className="text-(--icon-brand-green) ms-auto flex items-center gap-1 text-sm font-medium transition-opacity hover:opacity-80"
        >
          <RotateCw className="size-3.5" aria-hidden />
          重读
        </button>
      </div>

      {/* 播放/合成错误外显（FR-015 不静默失败） */}
      {audio.error && <p className="mt-2 text-xs text-red-500">{audio.error}</p>}

      {/* 示范读音置灰解释（ref_text/original_text/raw_text 全空时才触发——
          仅在无任何语音轮次数据的极端场景出现，正常 ISE 轮次均有源） */}
      {!demoTextOk && (
        <p className="text-muted-foreground mt-2 text-xs">
          本轮暂无示范读音来源；朗读一轮后即可使用英音/美音示范
        </p>
      )}
    </section>
  );
}

function PlayButton({
  label,
  disabled,
  active,
  onClick,
}: {
  label: string;
  disabled: boolean;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex items-center gap-1 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        active
          ? "text-(--icon-brand-green) font-semibold"
          : "text-foreground hover:text-foreground/70",
      )}
    >
      {label}
      <Volume2 className="size-4" aria-hidden />
    </button>
  );
}
