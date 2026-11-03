"use client";

import type { ProfileSummary } from "@/lib/profile-aggregate";

/**
 * 学习概览区块（US1，原型图第一卡，FR-003/004）：
 * 三统计卡（累计朗读轮数 / 平均综合分 1 位小数 / 平均语速 词每分）+
 * 最近 5 轮综合分柱状趋势（柱高按分数占 100 比例，对照原型图 .bars）。
 * 数据缺失显示 `--` 与引导文案，不虚构（FR-013）。
 */

const VALUE_CLASS = "text-primary text-2xl font-bold tabular-nums";

export function OverviewSection({
  summary,
  empty,
}: {
  summary: ProfileSummary;
  empty: boolean;
}) {
  const format = (value: number | null) => (value === null ? "--" : String(value));
  const trendEmpty = summary.trend.length === 0;

  return (
    <section className="rounded-2xl bg-background p-5 shadow-sm" data-slot="profile-overview">
      <h2 className="text-sm font-semibold">学习概览</h2>
      <div className="mt-4 grid grid-cols-3 gap-4">
        <StatCard value={empty ? null : String(summary.roundCount)} label="累计朗读（轮）" />
        <StatCard value={empty ? null : format(summary.avgTotal)} label="平均综合分" />
        <StatCard value={empty ? null : format(summary.avgSpeed)} label="平均语速（词/分）" />
      </div>

      <h2 className="mt-6 text-sm font-semibold">最近 5 轮综合分趋势</h2>
      {trendEmpty ? (
        <p className="text-muted-foreground py-8 text-center text-sm">
          {empty ? "完成第一次朗读后，这里会展示你的学习数据" : "最近轮次暂无综合分数据"}
        </p>
      ) : (
        <div className="mt-3 flex h-36 items-end gap-8 px-2">
          {summary.trend.map(({ label, total }) => (
            <div key={label} className="flex h-full min-w-10 flex-1 flex-col items-center justify-end">
              <span className="text-muted-foreground mb-1 text-xs tabular-nums">{total}</span>
              {/* 柱高按分数占 100 比例（原型图 .bar b） */}
              <div
                className="w-full rounded-t-md bg-primary"
                style={{ height: `${Math.max(2, Math.min(100, total))}%` }}
              />
              <span className="text-muted-foreground mt-1.5 text-xs">{label}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function StatCard({ value, label }: { value: string | null; label: string }) {
  return (
    <div className="rounded-xl bg-black/[0.03] px-3 py-4 text-center">
      <span className={VALUE_CLASS}>{value ?? "--"}</span>
      <span className="text-muted-foreground mt-1.5 block text-xs">{label}</span>
    </div>
  );
}
