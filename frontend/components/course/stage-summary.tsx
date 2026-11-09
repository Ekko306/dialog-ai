"use client";

import { CheckCircle2, LoaderCircle, Sparkles } from "lucide-react";

import type { SummaryPayload } from "@/lib/course-types";

interface StageSummaryProps {
  payload: SummaryPayload;
  onSubmit: (input: string) => void;
  submitting: boolean;
}

/** 环节 5 · 课时总结（T024）：总结 + 各环节结果 + 建议，完成后回到课程详情 */
export function StageSummary({ payload, onSubmit, submitting }: StageSummaryProps) {
  const scores = [
    { label: "跟读", value: payload.scores.intro === "passed" ? "已通过" : payload.scores.intro },
    { label: "练习", value: payload.scores.exercise },
    { label: "对话", value: `${payload.scores.roleplay_rounds} 轮` },
  ];

  return (
    <div className="space-y-4">
      <section className="rounded-3xl bg-(--bubble-ai) p-5">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="size-4" />
          本课小结
        </div>
        <p className="mt-2 text-sm leading-relaxed">{payload.summary}</p>
      </section>

      <section className="grid grid-cols-3 gap-2">
        {scores.map((score) => (
          <div
            key={score.label}
            className="bg-background rounded-2xl px-3 py-3 text-center shadow-sm ring-1 ring-black/5"
          >
            <div className="text-muted-foreground text-[11px]">{score.label}</div>
            <div className="mt-1 text-sm font-semibold">{score.value}</div>
          </div>
        ))}
      </section>

      {payload.suggestions.length > 0 && (
        <section className="bg-background rounded-3xl p-5 shadow-sm ring-1 ring-black/5">
          <h3 className="text-sm font-semibold">下一步建议</h3>
          <ul className="mt-2 space-y-2">
            {payload.suggestions.map((item) => (
              <li key={item} className="text-muted-foreground flex items-start gap-2 text-xs leading-relaxed">
                <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-(--icon-brand-green)" />
                {item}
              </li>
            ))}
          </ul>
        </section>
      )}

      <button
        type="button"
        disabled={submitting}
        onClick={() => onSubmit("done")}
        className="bg-primary text-primary-foreground flex h-12 w-full items-center justify-center gap-1 rounded-2xl text-sm font-medium transition hover:opacity-90 disabled:opacity-50"
      >
        {submitting ? <LoaderCircle className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
        完成课时
      </button>
    </div>
  );
}
