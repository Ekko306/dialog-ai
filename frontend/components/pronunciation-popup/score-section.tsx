"use client";

import { cn } from "@/lib/utils";

import type { PopupSnapshot } from "./popup-store";

/**
 * 评分建议区块（US2，原型图第二卡）：综合评分圆环徽章 + 三维度进度条 +
 * 语速仪表盘 + 中文建议列表。
 *
 * - 数值直取 ise_check_results.scores / speed_wpm，不做四舍五入错位（SC-004）；
 * - 综合评分兜底链 scores.total ?? ise_grade ?? null（FR-009）；
 * - speed_wpm == null → 仪表盘空态占位（FR-008/015）；区块数据缺失 → 空态提示
 *   （FR-007/015）；前端不虚构数值（SC-006）。
 */

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/** 分数展示：整数原样，小数保留 1 位（SC-004 不做四舍五入错位）；缺失显示 – */
const formatScore = (value: number | null | undefined): string => {
  if (value == null) return "–";
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 10) / 10);
};

const scoreColor = (value: number | null | undefined): string => {
  if (value == null) return "bg-muted-foreground/30";
  if (value >= 85) return "bg-(--icon-brand-green)";
  if (value >= 60) return "bg-orange-500";
  return "bg-red-500";
};

export function ScoreSection({ snapshot }: { snapshot: PopupSnapshot }) {
  const results = snapshot.ise_check_results;
  const empty = snapshot.ise_status !== "ok" || !results;
  const scores = results?.scores;
  const total = scores?.total ?? snapshot.ise_grade ?? null;
  const adviceLines =
    results?.advice
      ?.split(/(?<=[。！？])/)
      .map((line) => line.trim())
      .filter(Boolean) ?? [];

  return (
    <section data-slot="pronunciation-score">
      <h2 className="px-1 text-base font-bold">评分建议</h2>
      <div className="mt-2 rounded-2xl bg-background p-4 shadow-sm">
        {empty ? (
          // 降级路径的 advice 携带原因文本（state-data.md §1.2），优先展示
          <p className="text-muted-foreground py-8 text-center text-sm">
            {results?.advice?.trim() || "本轮没有评测数据"}
          </p>
        ) : (
          <>
            {/* 综合评分徽章：SVG 圆环 + 数值居中 */}
            <div className="flex items-center gap-3">
              <ScoreRing value={total} />
              <span className="text-foreground text-sm font-medium">综合评分</span>
            </div>

            {/* 三维度进度条（左） + 语速仪表盘（右），长内容纵向堆叠不溢出 */}
            <div className="mt-4 flex flex-col gap-4 min-[26rem]:flex-row min-[26rem]:items-center">
              <div className="flex flex-1 flex-col gap-3">
                <ScoreBar label="流利度" value={scores?.fluency} />
                <ScoreBar label="发音分" value={scores?.accuracy} />
                <ScoreBar label="完整度" value={scores?.integrity} />
              </div>
              <div className="min-[26rem]:w-[46%] shrink-0">
                <SpeedGauge wpm={results?.speed_wpm} />
              </div>
            </div>

            {adviceLines.length > 0 && (
              <ul className="text-foreground/90 mt-4 space-y-1.5 border-t border-dashed border-border pt-3 text-sm leading-relaxed">
                {adviceLines.map((line, index) => (
                  <li key={`${index}-${line.slice(0, 8)}`}>{line}</li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </section>
  );
}

/** 综合评分圆环：数值居中，环色随档位（≥85 绿 / 60~84 橙 / <60 红 / 缺失灰） */
function ScoreRing({ value }: { value: number | null }) {
  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  const progress = value == null ? null : clamp01(value / 100);
  const color =
    value == null
      ? "stroke-muted-foreground/30"
      : value >= 85
        ? "stroke-(--icon-brand-green)"
        : value >= 60
          ? "stroke-orange-500"
          : "stroke-red-500";

  return (
    <svg
      width="60"
      height="60"
      viewBox="0 0 64 64"
      role="img"
      aria-label={`综合评分 ${formatScore(value)}`}
    >
      <circle cx="32" cy="32" r={radius} fill="none" strokeWidth="5" className="stroke-muted" />
      {progress !== null && (
        <circle
          cx="32"
          cy="32"
          r={radius}
          fill="none"
          strokeWidth="5"
          strokeLinecap="round"
          className={cn("transition-[stroke-dashoffset]", color)}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - progress)}
          transform="rotate(-90 32 32)"
        />
      )}
      <text x="32" y="37" textAnchor="middle" className="fill-foreground text-[15px] font-bold">
        {formatScore(value)}
      </text>
    </svg>
  );
}

function ScoreBar({ label, value }: { label: string; value: number | null | undefined }) {
  const progress = value == null ? null : clamp01(value / 100);
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="w-12 shrink-0">{label}</span>
      <span className="w-9 shrink-0 text-end tabular-nums">{formatScore(value)}</span>
      <span className="bg-muted relative h-2 min-w-16 flex-1 overflow-hidden rounded-full">
        {progress !== null && (
          <span
            className={cn("absolute inset-y-0 start-0 rounded-full", scoreColor(value))}
            style={{ width: `${progress * 100}%` }}
          />
        )}
      </span>
    </div>
  );
}

/**
 * 语速仪表盘：SVG 半弧（量程 50→250 词/分，110/150/190 刻度点，
 * Slow→Fast 绿→黄→红渐变），指针角度线性映射并夹取 [0,1]；量程外数值
 * 仍显示真实数字（SC-004）。speed_wpm == null → 空态占位（FR-008/015）。
 */
function SpeedGauge({ wpm }: { wpm: number | null | undefined }) {
  const CX = 100;
  const CY = 95;
  const R = 72;

  // t: 0（50 词/分，左端）→ 1（250 词/分，右端），指针角度 = 180° - t×180°
  const t = wpm == null ? null : clamp01((wpm - 50) / 200);
  const pointAt = (r: number, ratio: number) => {
    const angle = (180 - ratio * 180) * (Math.PI / 180);
    return { x: CX + r * Math.cos(angle), y: CY - r * Math.sin(angle) };
  };
  const ticks = [110, 150, 190].map((value) => ({
    value,
    ratio: (value - 50) / 200,
  }));

  return (
    <svg
      viewBox="0 0 200 122"
      className="w-full"
      role="img"
      aria-label={`语速 ${wpm == null ? "暂无" : `${wpm}词/分`}`}
    >
      <defs>
        <linearGradient
          id="speed-gauge-gradient"
          x1="28"
          y1="95"
          x2="172"
          y2="95"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#84cc16" />
          <stop offset="0.5" stopColor="#eab308" />
          <stop offset="1" stopColor="#ef4444" />
        </linearGradient>
      </defs>

      {/* 主弧：空态灰色占位，有数据时渐变 */}
      <path
        d={`M ${CX - R} ${CY} A ${R} ${R} 0 0 1 ${CX + R} ${CY}`}
        fill="none"
        strokeWidth="14"
        strokeLinecap="round"
        stroke={t == null ? "#e5e5e5" : "url(#speed-gauge-gradient)"}
      />

      {/* 刻度点：110 / 150 / 190 */}
      {ticks.map(({ value, ratio }) => {
        const outer = pointAt(R + 2, ratio);
        const label = pointAt(R + 15, ratio);
        return (
          <g key={value}>
            <line
              x1={outer.x}
              y1={outer.y}
              x2={pointAt(R - 9, ratio).x}
              y2={pointAt(R - 9, ratio).y}
              stroke="#a3a3a3"
              strokeWidth="1.5"
            />
            <text x={label.x} y={label.y} textAnchor="middle" fontSize="10" fill="#737373">
              {value}
            </text>
          </g>
        );
      })}

      {/* 指针：中心到弧内侧，橙色 */}
      {t !== null && (
        <line
          x1={CX}
          y1={CY}
          x2={pointAt(R - 18, t).x}
          y2={pointAt(R - 18, t).y}
          stroke="#f97316"
          strokeWidth="4"
          strokeLinecap="round"
        />
      )}

      {/* 中心数值（量程外仍显示真实数字）+ Slow/Fast */}
      <text x={CX} y={CY - 14} textAnchor="middle" fontSize="16" fontWeight="700" fill="#171717">
        {wpm == null ? "暂无" : `${wpm}词/分`}
      </text>
      <text x={CX} y={CY + 2} textAnchor="middle" fontSize="10" fill="#737373">
        （语速）
      </text>
      <text x={CX - R + 4} y={CY + 16} textAnchor="start" fontSize="11" fill="#84cc16">
        Slow
      </text>
      <text x={CX + R - 4} y={CY + 16} textAnchor="end" fontSize="11" fill="#ef4444">
        Fast
      </text>
    </svg>
  );
}
