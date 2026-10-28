"use client";

import { Check, Copy, Mic, Star, Volume2 } from "lucide-react";
import { useState } from "react";
import { cn } from "cn";
import { CorrectionBubbleFollowAlong } from "@/components/follow-along-panel/follow-along-panel";
import { useTtsButton } from "@/components/correction-bubble/use-tts-button";
import { useHint } from "@/lib/use-hint";
import type { CorrectionInput } from "@/lib/tts-client";

/**
 * 纠错气泡底部操作栏（US1 T007 布局 · US2 T010 复制 · US3 T012 正确句发音 ·
 * US4 T014 跟读面板入口 · FR-014 收藏静态占位），原型图最底行四按钮横排。
 */
interface CorrectionActionsProps {
  messageId: string;
  rawText: string;
  corrections: CorrectionInput[];
}

export function CorrectionActions({ messageId, rawText, corrections }: CorrectionActionsProps) {
  const [copied, setCopied] = useState(false);
  const [hint, showHint] = useHint();
  const { handlePlay, loading, status } = useTtsButton(
    messageId,
    "correct",
    rawText,
    corrections,
    showHint,
  );
  const openFollowAlong = CorrectionBubbleFollowAlong.useOpen();
  const isPlaying = status === "playing";

  // 复制仅改正后的完整正确句（US2/FR-003）；清单为空降级为禁用（spec Edge Case）
  const correctText = corrections[0]?.correct;
  const handleCopy = async () => {
    if (!correctText) return;
    try {
      await navigator.clipboard.writeText(correctText);
    } catch {
      // Clipboard API 被拒（权限受限/非聚焦/WebView 环境）时的兜底：
      // 隐藏 textarea + execCommand，仍失败才提示手动复制
      const ta = document.createElement("textarea");
      ta.value = correctText;
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
      {/* 循环跟读：打开底部面板（US4 T014） */}
      <button
        type="button"
        onClick={() => openFollowAlong(messageId, correctText ?? rawText, rawText, corrections)}
        aria-label="循环跟读"
        className="flex cursor-pointer items-center gap-1 rounded-md px-0.5 py-0.5 transition-colors hover:bg-black/5"
      >
        <Mic className="size-4" aria-hidden />
        循环跟读
      </button>

      {/* 复制：仅复制改正后完整句（US2），成功反馈对勾 1.5s */}
      <button
        type="button"
        onClick={() => void handleCopy()}
        disabled={!correctText}
        aria-label="复制改正后的句子"
        className="flex cursor-pointer items-center gap-1 rounded-md px-0.5 py-0.5 transition-colors hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {copied ? (
          <Check className="size-4 text-green-600" aria-hidden />
        ) : (
          <Copy className="size-4" aria-hidden />
        )}
        复制
      </button>

      {/* 收藏：FR-014 静态占位（轻提示，无副作用） */}
      <button
        type="button"
        onClick={() => showHint("功能开发中")}
        aria-label="收藏"
        className="flex cursor-pointer items-center gap-1 rounded-md px-0.5 py-0.5 transition-colors hover:bg-black/5"
      >
        <Star className="size-4" aria-hidden />
        收藏
      </button>

      {/* AI 发音：播改正后句子（US3 T012），与功能行 AI 共享全局互斥 */}
      <button
        type="button"
        onClick={() => void handlePlay()}
        disabled={loading}
        aria-label="播放改正后句子发音"
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
