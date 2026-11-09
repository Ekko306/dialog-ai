"use client";

import {
  BookX,
  CheckCircle2,
  ChevronLeft,
  Circle,
  LoaderCircle,
  RotateCcw,
} from "lucide-react";
import { useState } from "react";

import { useCourseStore } from "@/lib/course-store";
import type { MistakeEntry, MistakeStatus } from "@/lib/course-types";

type MistakeFilter = "all" | MistakeStatus;

const FILTER_LABELS: Record<MistakeFilter, string> = {
  all: "全部",
  pending: "待复习",
  mastered: "已掌握",
};

/**
 * 错题本（练习环节答错自动记录）：
 * 列出我的作答 / 参考答案 / AI 点评，支持标记已掌握或重新加入待复习。
 */
export function MistakeBook() {
  const {
    mistakes,
    mistakesSummary,
    mistakesState,
    mistakesError,
    closeMistakes,
    loadMistakes,
    setMistakeMastered,
  } = useCourseStore();

  const [filter, setFilter] = useState<MistakeFilter>("all");
  const [busyId, setBusyId] = useState<string | null>(null);

  const visible = mistakes.filter((entry) =>
    filter === "all" ? true : entry.status === filter,
  );

  const toggleMastered = async (entry: MistakeEntry) => {
    setBusyId(entry.id);
    try {
      await setMistakeMastered(entry.id, entry.status !== "mastered");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl px-5 pt-4 pb-6">
        <header className="flex items-center gap-2">
          <button
            type="button"
            onClick={closeMistakes}
            aria-label="返回课程列表"
            className="text-muted-foreground hover:text-foreground -ml-2 rounded-full p-2 transition"
          >
            <ChevronLeft className="size-5" />
          </button>
          <h1 className="text-lg font-bold">错题本</h1>
        </header>

        {mistakesSummary && (
          <p className="text-muted-foreground mt-2 text-xs">
            共 {mistakesSummary.total} 题 · 待复习 {mistakesSummary.pending} 题 · 已掌握{" "}
            {mistakesSummary.mastered} 题
          </p>
        )}

        <div className="bg-background mt-3 flex gap-1 rounded-full p-1 shadow-sm ring-1 ring-black/5">
          {(Object.keys(FILTER_LABELS) as MistakeFilter[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={`flex-1 rounded-full py-1.5 text-xs font-medium transition ${
                filter === key
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {FILTER_LABELS[key]}
            </button>
          ))}
        </div>

        {mistakesState === "loading" && (
          <div className="mt-6 flex items-center justify-center gap-2">
            <LoaderCircle className="text-primary size-4 animate-spin" />
            <span className="text-muted-foreground text-[11px]">加载中…</span>
          </div>
        )}

        {mistakesState === "error" && (
          <section className="bg-background mt-5 rounded-3xl p-8 text-center shadow-sm">
            <p className="text-sm text-red-500">错题本加载失败：{mistakesError ?? "未知错误"}</p>
            <button
              type="button"
              onClick={() => void loadMistakes()}
              className="bg-primary text-primary-foreground mt-4 rounded-xl px-5 py-2 text-sm"
            >
              重试
            </button>
          </section>
        )}

        {mistakesState === "ready" && visible.length === 0 && (
          <section className="bg-background mt-5 flex flex-col items-center gap-2 rounded-3xl p-10 text-center shadow-sm">
            <BookX className="text-muted-foreground size-8" />
            <p className="text-sm font-medium">
              {filter === "all" ? "还没有错题" : `暂无${FILTER_LABELS[filter]}的题目`}
            </p>
            <p className="text-muted-foreground text-xs">
              练习环节答错会自动收进这里，方便集中复习
            </p>
          </section>
        )}

        {mistakesState === "ready" && visible.length > 0 && (
          <div className="mt-4 space-y-3">
            {visible.map((entry) => (
              <MistakeCard
                key={entry.id}
                entry={entry}
                busy={busyId === entry.id}
                onToggle={() => void toggleMastered(entry)}
              />
            ))}
          </div>
        )}

        {mistakesError && mistakesState === "ready" && (
          <p className="mt-3 text-center text-xs text-red-500">{mistakesError}</p>
        )}
      </div>
    </div>
  );
}

interface MistakeCardProps {
  entry: MistakeEntry;
  busy: boolean;
  onToggle: () => void;
}

function MistakeCard({ entry, busy, onToggle }: MistakeCardProps) {
  const mastered = entry.status === "mastered";

  return (
    <section className="bg-background rounded-3xl p-4 shadow-sm ring-1 ring-black/5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-muted-foreground truncate text-[11px]">
            {entry.course_name} · {entry.lesson_name}
          </p>
          <p className="mt-1 text-sm font-medium">{entry.question}</p>
        </div>
        <span
          className={`flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium ${
            mastered
              ? "bg-(--icon-brand-green)/12 text-(--icon-brand-green)"
              : "bg-amber-50 text-amber-700 ring-1 ring-amber-200"
          }`}
        >
          {mastered ? <CheckCircle2 className="size-3.5" /> : <Circle className="size-3.5" />}
          {mastered ? "已掌握" : "待复习"}
        </span>
      </div>

      <div className="mt-3 space-y-2 text-xs leading-relaxed">
        <div className="rounded-2xl bg-red-50 px-3 py-2 text-red-800">
          <span className="font-medium">我的作答：</span>
          {entry.user_answer || "（未作答）"}
        </div>
        {entry.reference_answer && (
          <div className="rounded-2xl bg-emerald-50 px-3 py-2 text-emerald-800">
            <span className="font-medium">参考答案：</span>
            {entry.reference_answer}
          </div>
        )}
        {entry.feedback && (
          <p className="text-muted-foreground px-1">{entry.feedback}</p>
        )}
        {entry.suggested && (
          <p className="text-foreground/70 px-1 italic">更自然：{entry.suggested}</p>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="text-muted-foreground text-[11px]">答错 {entry.wrong_count} 次</span>
        <button
          type="button"
          onClick={onToggle}
          disabled={busy}
          className="text-muted-foreground hover:text-foreground flex shrink-0 items-center gap-1 rounded-full bg-muted px-3 py-1.5 text-[11px] font-medium transition disabled:opacity-50"
        >
          {busy ? (
            <LoaderCircle className="size-3.5 animate-spin" />
          ) : mastered ? (
            <RotateCcw className="size-3.5" />
          ) : (
            <CheckCircle2 className="size-3.5" />
          )}
          {mastered ? "重新待复习" : "标记已掌握"}
        </button>
      </div>
    </section>
  );
}
