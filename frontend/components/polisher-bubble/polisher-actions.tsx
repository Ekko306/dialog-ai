"use client";

import { Check, Copy, Mic, Star, Volume2 } from "lucide-react";
import { useState } from "react";
import { cn } from "cn";
import { CorrectionBubbleFollowAlong } from "@/components/follow-along-panel/follow-along-panel";
import { useTtsButton } from "@/components/correction-bubble/use-tts-button";
import { useHint } from "@/lib/use-hint";
import type { CorrectionInput } from "@/lib/tts-client";

/**
 * 润色气泡底部操作栏（005 T009，FR-005，spec Assumptions ⑤）：
 * 循环跟读｜复制｜收藏｜AI 发音，全部作用于润色句（R1 伪条目由 bubble 构造传入）。
 * 布局与行为对齐 correction-actions.tsx（003 已验收基线），音频共享全局互斥（FR-011）。
 */
interface PolisherActionsProps {
  messageId: string;
  rawText: string;
  polishedText: string;
  polishAsCorrection: CorrectionInput[];
}

export function PolisherActions({
  messageId,
  rawText,
  polishedText,
  polishAsCorrection,
}: PolisherActionsProps) {
  const [copied, setCopied] = useState(false);
  const [hint, showHint] = useHint();
  const { handlePlay, loading, status } = useTtsButton(
    messageId,
    "correct",
    rawText,
    polishAsCorrection,
    showHint,
  );
  const openFollowAlong = CorrectionBubbleFollowAlong.useOpen();
  const isPlaying = status === "playing";

  // 复制润色句（FR-005）；Clipboard API 被拒时 execCommand 兜底（003 handleCopy 同款）
  const handleCopy = async () => {
    if (!polishedText) return;
    try {
      await navigator.clipboard.writeText(polishedText);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = polishedText;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      if (!ok) {
        showHint("复制失败，请手动选择文本");
        return;
      }
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="mt-2.5 flex items-center gap-4 border-t border-black/10 pt-2 text-sm">
      {/* 循环跟读：打开底部面板，跟读内容为润色句 */}
      <button
        type="button"
        onClick={() => openFollowAlong(messageId, polishedText, rawText, polishAsCorrection)}
        aria-label="循环跟读"
        className="flex cursor-pointer items-center gap-1 rounded-md px-0.5 py-0.5 transition-colors hover:bg-black/5"
      >
        <Mic className="size-4" aria-hidden />
        循环跟读
      </button>

      {/* 复制：复制润色完整句，成功反馈对勾 1.5s */}
      <button
        type="button"
        onClick={() => void handleCopy()}
        disabled={!polishedText}
        aria-label="复制润色后的句子"
        className="flex cursor-pointer items-center gap-1 rounded-md px-0.5 py-0.5 transition-colors hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {copied ? (
          <Check className="size-4 text-green-600" aria-hidden />
        ) : (
          <Copy className="size-4" aria-hidden />
        )}
        复制
      </button>

      {/* 收藏：占位（轻提示，无副作用） */}
      <button
        type="button"
        onClick={() => showHint("功能开发中")}
        aria-label="收藏"
        className="flex cursor-pointer items-center gap-1 rounded-md px-0.5 py-0.5 transition-colors hover:bg-black/5"
      >
        <Star className="size-4" aria-hidden />
        收藏
      </button>

      {/* AI 发音：播润色句（R1 correct kind），与功能行 AI 共享全局互斥 */}
      <button
        type="button"
        onClick={() => void handlePlay()}
        disabled={loading}
        aria-label="播放润色后句子发音"
        className="ml-auto flex cursor-pointer items-center gap-0.5 rounded-md px-0.5 py-0.5 transition-colors hover:bg-black/5 disabled:opacity-50"
      >
        AI
        {loading ? (
          <span className="size-3.5 animate-pulse rounded-full bg-current" aria-hidden />
        ) : (
          <Volume2 className={cn("size-4", isPlaying && "text-green-600")} aria-hidden />
        )}
      </button>

      {hint && <span className="text-muted-foreground text-xs">{hint}</span>}
    </div>
  );
}
