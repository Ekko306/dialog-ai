"use client";

import { useEffect, useState } from "react";

import {
  deriveSummary,
  deriveWeakWords,
  fetchProfileRounds,
  type ProfileRound,
} from "@/lib/profile-aggregate";
import { FavoritesSection } from "./favorites-section";
import { OverviewSection } from "./overview-section";
import { SettingsSection } from "./settings-section";
import { WeakWordsSection } from "./weak-words-section";

type LoadState = "loading" | "error" | "ready";

/**
 * 我的 · 个人中心页（US1~US4，research R1/R2）：
 * - 挂载于 001 底部 TabBar tab3（R1）；每次切入重新聚合（数据新鲜，骨架即时呈现满足 SC-001）；
 * - 四态：loading 骨架 / error 错误提示+重试（FR-014）/ ready 渲染四区块；
 *   有效轮次为 0 时由各区块展示空态占位与引导（FR-013），统计卡显示 "--" 不虚构；
 * - 数据全部前端聚合（FR-005 后端零改动）。
 */
export function MyProfilePage() {
  const [state, setState] = useState<LoadState>("loading");
  const [rounds, setRounds] = useState<ProfileRound[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reloadSeq, setReloadSeq] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    setErrorMessage(null);
    fetchProfileRounds()
      .then((result) => {
        if (cancelled) return;
        setRounds(result);
        setState("ready");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setErrorMessage(error instanceof Error ? error.message : "数据加载失败");
        setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [reloadSeq]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl px-6 py-6">
        <h1 className="text-xl font-bold">我的 · 个人中心</h1>
        <p className="text-muted-foreground mt-1 mb-6 text-xs">
          数据来源：本机历史会话（最近 50 条朗读轮次聚合）
        </p>

        {state === "loading" && <LoadingSkeleton />}

        {state === "error" && (
          <section className="rounded-2xl bg-background p-8 text-center shadow-sm">
            <p className="text-sm text-red-500">数据加载失败：{errorMessage ?? "未知错误"}</p>
            <button
              type="button"
              onClick={() => setReloadSeq((seq) => seq + 1)}
              className="bg-primary text-primary-foreground mt-4 rounded-lg px-5 py-2 text-sm transition-opacity hover:opacity-90"
            >
              重试
            </button>
          </section>
        )}

        {state === "ready" && (
          <div className="space-y-5 pb-6">
            <OverviewSection summary={deriveSummary(rounds)} empty={rounds.length === 0} />
            <WeakWordsSection words={deriveWeakWords(rounds)} noRounds={rounds.length === 0} />
            <FavoritesSection />
            <SettingsSection />
          </div>
        )}
      </div>
    </div>
  );
}

/** 加载骨架（SC-001：切 Tab 1s 内出现——客户端渲染即时展示） */
function LoadingSkeleton() {
  return (
    <div className="space-y-5 pb-6" aria-busy="true" aria-label="加载中">
      <section className="rounded-2xl bg-background p-5 shadow-sm">
        <div className="h-4 w-20 animate-pulse rounded bg-muted" />
        <div className="mt-4 grid grid-cols-3 gap-4">
          <div className="h-20 animate-pulse rounded-xl bg-muted" />
          <div className="h-20 animate-pulse rounded-xl bg-muted" />
          <div className="h-20 animate-pulse rounded-xl bg-muted" />
        </div>
        <div className="mt-6 h-4 w-36 animate-pulse rounded bg-muted" />
        <div className="mt-3 h-28 animate-pulse rounded-xl bg-muted" />
      </section>
      <section className="rounded-2xl bg-background p-5 shadow-sm">
        <div className="h-4 w-20 animate-pulse rounded bg-muted" />
        <div className="mt-4 h-24 animate-pulse rounded-xl bg-muted" />
      </section>
      <section className="h-32 animate-pulse rounded-2xl bg-background shadow-sm" />
      <section className="h-40 animate-pulse rounded-2xl bg-background shadow-sm" />
    </div>
  );
}
