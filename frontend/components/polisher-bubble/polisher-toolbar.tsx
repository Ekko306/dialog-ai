"use client";

import { ChevronDown, ChevronUp, Languages, Sparkles, Volume2 } from "lucide-react";
import { cn } from "cn";
import { useTtsButton } from "@/components/correction-bubble/use-tts-button";
import { useHint } from "@/lib/use-hint";
import type { CorrectionInput } from "@/lib/tts-client";

/**
 * 润色气泡功能行（005 T006/T010，spec Assumptions ②，原型图对照）：
 * 左「文A」翻译开关（复用 004 状态机）· 中「✨拓展润色 ⌃/⌄」双态切换（FR-003）·
 * 右「AI 🔊」原句发音（R4：raw kind 合成输入为 raw_text，伪条目不影响）。
 * 布局与样式对齐 correction-toolbar.tsx（003 已验收基线）。
 */
interface PolisherToolbarProps {
  messageId: string;
  rawText: string;
  polishAsCorrection: CorrectionInput[];
  expanded: boolean;
  onToggle: () => void;
  translationOpen: boolean;
  onToggleTranslation: () => void;
}

export function PolisherToolbar({
  messageId,
  rawText,
  polishAsCorrection,
  expanded,
  onToggle,
  translationOpen,
  onToggleTranslation,
}: PolisherToolbarProps) {
  const [hint, showHint] = useHint();
  const { handlePlay, loading, status } = useTtsButton(
    messageId,
    "raw",
    rawText,
    polishAsCorrection,
    showHint,
  );
  const isPlaying = status === "playing";

  return (
    <>
      <div className="mt-2.5 flex items-center justify-between">
        {/* 文A：翻译展开/收起（FR-006，004 全套行为自动继承） */}
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

        {/* 拓展润色：双态切换标签（FR-003，展开态箭头向上/收起态向下） */}
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-sm font-medium transition-colors hover:bg-black/5"
        >
          <Sparkles className="size-3.5 text-amber-500" aria-hidden />
          拓展润色
          {expanded ? (
            <ChevronUp className="size-3.5" aria-hidden />
          ) : (
            <ChevronDown className="size-3.5" aria-hidden />
          )}
        </button>

        {/* AI 发音：播原句（R4），合成中 loading 防重复点击 */}
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

      {/* 合成/请求失败轻提示（沿用 003 FR-012 行为）：置于行下方，不打乱三按钮布局 */}
      {hint && <p className="text-muted-foreground mt-1 text-xs">{hint}</p>}
    </>
  );
}
