"use client";

import { Volume2 } from "lucide-react";

import { ttsSourceKey, usePopupAudio } from "@/components/pronunciation-popup/use-popup-audio";
import type { WeakWord } from "@/lib/profile-aggregate";
import { getSettings } from "@/lib/profile-settings";
import { cn } from "@/lib/utils";

/**
 * 错词本区块（US2，原型图第二卡，FR-006/007）：
 * 弱项词列表——词 / 档位徽章（poor=待提高 fair=小瑕疵）/ 累计次数 + 连读·重读标注；
 * 🔊 试听调 use-popup-audio 单例播放器（POST /api/audio/tts，口音跟随设置，research R4③）；
 * 空态文案对照原型图与 FR-013，不虚构数据。
 */

const QUALITY_BADGES: Record<WeakWord["worstQuality"], { label: string; className: string }> = {
  poor: { label: "待提高", className: "bg-red-500/10 text-red-500" },
  fair: { label: "小瑕疵", className: "bg-orange-500/10 text-orange-500" },
};

const EXTRA_LABELS: Record<WeakWord["extras"][number], string> = {
  liaison: "连读",
  stress: "重读词",
};

export function WeakWordsSection({
  words,
  noRounds,
}: {
  words: WeakWord[];
  /** 无任何朗读轮次（FR-013 固定空态文案触发条件） */
  noRounds: boolean;
}) {
  const audio = usePopupAudio();

  if (words.length === 0) {
    return (
      <section className="rounded-2xl bg-background p-5 shadow-sm" data-slot="profile-weak-words">
        <h2 className="text-sm font-semibold">错词本</h2>
        <p className="text-muted-foreground py-8 text-center text-sm">
          {noRounds
            ? "完成第一次朗读后，这里会汇总你的高频弱项词"
            : "暂无弱项词，继续保持！"}
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl bg-background p-5 shadow-sm" data-slot="profile-weak-words">
      <h2 className="text-sm font-semibold">错词本</h2>
      <ul className="mt-2">
        {words.map((word) => {
          const badge = QUALITY_BADGES[word.worstQuality];
          const accent = getSettings().accent;
          const active =
            audio.activeKey === ttsSourceKey(accent, word.word) && audio.status !== "idle";
          return (
            <li
              key={word.key}
              className="flex items-center gap-3 border-b border-border py-3 last:border-b-0"
            >
              <span className="min-w-28 flex-1 text-[15px] font-semibold wrap-break-word">
                {word.word}
              </span>
              <span
                className={cn("rounded-full px-2.5 py-0.5 text-[11px] whitespace-nowrap", badge.className)}
              >
                {badge.label}
              </span>
              <span className="text-muted-foreground flex-1 text-xs">
                {word.count} 次
                {word.extras.length > 0 && (
                  <span className="text-muted-foreground/70">
                    {" · "}
                    {word.extras.map((extra) => EXTRA_LABELS[extra]).join(" · ")}
                  </span>
                )}
              </span>
              <button
                type="button"
                onClick={() => audio.play({ kind: "tts", text: word.word, accent })}
                className={cn(
                  "flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-[13px] transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-40",
                  active && "border-primary text-primary",
                )}
              >
                <Volume2 className="size-3.5" aria-hidden />
                试听
              </button>
            </li>
          );
        })}
      </ul>

      {/* 播放/合成错误外显（FR-015 不静默失败） */}
      {audio.error && <p className="mt-2 text-xs text-red-500">{audio.error}</p>}
    </section>
  );
}
