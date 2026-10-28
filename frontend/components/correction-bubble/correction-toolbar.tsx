"use client";

import { ChevronDown, ChevronUp, Languages, TriangleAlert, Volume2 } from "lucide-react";
import { cn } from "cn";
import { useTtsButton } from "@/components/correction-bubble/use-tts-button";
import { useHint } from "@/lib/use-hint";
import type { CorrectionInput } from "@/lib/tts-client";

/**
 * 纠错气泡功能行（US1 T006，原型图第二行）：左「文A」翻译开关（US5）·
 * 中「‼ 语法纠错 ⌃/⌄」双态切换（FR-002）· 右「AI 🔊」原句发音（US3 FR-004）。
 */
interface CorrectionToolbarProps {
  messageId: string;
  rawText: string;
  corrections: CorrectionInput[];
  expanded: boolean;
  onToggle: () => void;
  translationOpen: boolean;
  onToggleTranslation: () => void;
}

export function CorrectionToolbar({
  messageId,
  rawText,
  corrections,
  expanded,
  onToggle,
  translationOpen,
  onToggleTranslation,
}: CorrectionToolbarProps) {
  const [hint, showHint] = useHint();
  const { handlePlay, loading, status } = useTtsButton(
    messageId,
    "raw",
    rawText,
    corrections,
    showHint,
  );
  const isPlaying = status === "playing";

  return (
    <>
      <div className="mt-2.5 flex items-center justify-between">
        {/* 文A：翻译展开/收起（US5，后端无译文字段时显示占位） */}
        <button
          type="button"
          onClick={onToggleTranslation}
          aria-pressed={translationOpen}
          aria-label="翻译"
          className={cn(
            "flex cursor-pointer items-center rounded-md px-1 py-0.5 transition-colors hover:bg-black/5",
            translationOpen && "bg-black/10",
          )}
        >
          <Languages className="size-4" aria-hidden />
        </button>

        {/* ‼ 语法纠错：双态切换标签（FR-002，展开态箭头向上/收起态向下） */}
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-sm font-medium transition-colors hover:bg-black/5"
        >
          <TriangleAlert className="size-3.5 text-red-500" aria-hidden />
          语法纠错
          {expanded ? (
            <ChevronUp className="size-3.5" aria-hidden />
          ) : (
            <ChevronDown className="size-3.5" aria-hidden />
          )}
        </button>

        {/* AI 发音：播用户原句（US3 T011），合成中 loading 防重复点击 */}
        <button
          type="button"
          onClick={() => void handlePlay()}
          disabled={loading}
          aria-label="播放原句发音"
          className="flex cursor-pointer items-center gap-0.5 rounded-md px-1 py-0.5 text-sm font-medium transition-colors hover:bg-black/5 disabled:opacity-50"
        >
          AI
          {loading ? (
            <span className="size-3.5 animate-pulse rounded-full bg-current" aria-hidden />
          ) : (
            <Volume2 className={cn("size-4", isPlaying && "text-green-600")} aria-hidden />
          )}
        </button>
      </div>

      {/* 合成/请求失败轻提示（FR-012/T021）：置于行下方，不打乱三按钮布局 */}
      {hint && <p className="text-muted-foreground mt-1 text-xs">{hint}</p>}
    </>
  );
}
