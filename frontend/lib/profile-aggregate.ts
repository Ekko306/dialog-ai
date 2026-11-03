/**
 * threads 聚合纯函数（research R2 / contracts/threads-api.md，FR-005 后端零改动）：
 * 1. fetchProfileRounds：经既有 /api 代理两步聚合——
 *    POST /api/threads/search（limit 30）→ 逐线程 POST /api/threads/{id}/history
 *    （limit 100，Promise.all 并发 ≤6），收集 ise_status==="ok" 且含
 *    ise_check_results 的快照为 ProfileRound，凑满 50 轮即停；不足时
 *    threads/search 按 offset 最多再翻一页（contracts §1）。
 *    单线程 history 失败跳过继续（部分数据可展示）；threads/search 失败抛错
 *    → 页面 error 态（FR-014 禁静默失败）。
 * 2. deriveSummary / deriveWeakWords：纯派生，全部在前端视图层（Constitution III）。
 *
 * 错词本派生复用 word-marks.ts 常量（qualityOf/normalizeWord/SILENCE_TOKENS，
 * R8 禁止复制阈值）；sil 静音 token 与 good 档词在轮次收集时即过滤（data-model §2.1）。
 */

import { type IseCheckResults } from "@/components/pronunciation-popup/popup-store";
import {
  type WordExtra,
  SILENCE_TOKENS,
  extrasOf,
  normalizeWord,
  qualityOf,
} from "@/components/pronunciation-popup/word-marks";

// ========== 聚合最小轮次单元（data-model §2.1） ==========

export interface ProfileRound {
  threadId: string;
  /** 快照时间（检查点 created_at 优先，趋势排序用） */
  updatedAt: string;
  total: number | null;
  speedWpm: number | null;
  /** 已过滤 sil 静音 token 与 good 档词，仅留 poor/fair 弱项词 */
  words: { word: string; quality: "poor" | "fair"; extras: WordExtra[] }[];
}

// ========== 聚合参数（可调，spec Assumptions：50 为可调参数非硬契约） ==========

const TARGET_ROUNDS = 50;
const SEARCH_PAGE_SIZE = 30;
const HISTORY_LIMIT = 100;
/** 首页 + 最多再翻一页（contracts §1） */
const MAX_PAGES = 2;
const CONCURRENCY = 6;

const JSON_HEADERS = { "Content-Type": "application/json" } as const;

interface ThreadBrief {
  thread_id: string;
  updated_at?: string;
}

interface Checkpoint {
  values?: Record<string, unknown>;
  created_at?: string;
}

/** 轮次字段提取（data-model §1.1）：字段缺失/类型不符一律按空处理不虚构 */
const toRound = (thread: ThreadBrief, checkpoint: Checkpoint): ProfileRound | null => {
  const values = checkpoint.values;
  if (!values || values.ise_status !== "ok") return null;
  const results = values.ise_check_results as IseCheckResults | null | undefined;
  if (!results) return null;
  const words = (results.pronunciation ?? [])
    .map((item) => ({
      word: item.word,
      quality: qualityOf(item.score),
      extras: extrasOf(item.comment),
    }))
    .filter(
      (w): w is { word: string; quality: "poor" | "fair"; extras: WordExtra[] } =>
        w.quality !== "good" && w.quality !== null && !SILENCE_TOKENS.has(normalizeWord(w.word)),
    );
  const scores = results.scores;
  return {
    threadId: thread.thread_id,
    updatedAt: checkpoint.created_at ?? thread.updated_at ?? "",
    total: typeof scores?.total === "number" ? scores.total : null,
    speedWpm: typeof results.speed_wpm === "number" ? results.speed_wpm : null,
    words,
  };
};

const fetchThreadRounds = async (thread: ThreadBrief): Promise<ProfileRound[]> => {
  const res = await fetch(`/api/threads/${thread.thread_id}/history`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ limit: HISTORY_LIMIT }),
  });
  if (!res.ok) throw new Error(`threads/${thread.thread_id}/history failed: ${res.status}`);
  const checkpoints = (await res.json()) as Checkpoint[];
  return checkpoints
    .map((checkpoint) => toRound(thread, checkpoint))
    .filter((round): round is ProfileRound => round !== null);
};

export async function fetchProfileRounds(): Promise<ProfileRound[]> {
  const rounds: ProfileRound[] = [];

  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await fetch("/api/threads/search", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ limit: SEARCH_PAGE_SIZE, offset: page * SEARCH_PAGE_SIZE }),
    });
    if (!res.ok) throw new Error(`threads/search failed: ${res.status}`);
    const threads = (await res.json()) as ThreadBrief[];
    if (!Array.isArray(threads)) throw new Error("threads/search returned unexpected payload");

    for (let i = 0; i < threads.length; i += CONCURRENCY) {
      const batch = threads.slice(i, i + CONCURRENCY);
      // 单线程失败跳过继续（contracts §3：部分数据可展示）
      const settled = await Promise.all(
        batch.map((thread) => fetchThreadRounds(thread).catch(() => [] as ProfileRound[])),
      );
      for (const threadRounds of settled) {
        rounds.push(...threadRounds);
        if (rounds.length >= TARGET_ROUNDS) return rounds.slice(0, TARGET_ROUNDS);
      }
    }

    // 本页不满 → 已无更多线程，无需翻页
    if (threads.length < SEARCH_PAGE_SIZE) break;
  }

  return rounds;
}

// ========== 概览派生（US1，data-model §2.2） ==========

export interface ProfileSummary {
  roundCount: number;
  /** 平均综合分保留 1 位小数；无数据 → null → 展示 "--" */
  avgTotal: number | null;
  /** 平均语速（词/分）取整；无数据 → null */
  avgSpeed: number | null;
  /** 最近 5 轮综合分（时间正序），null 不计入 */
  trend: { label: string; total: number }[];
}

export function deriveSummary(rounds: ProfileRound[]): ProfileSummary {
  const totals = rounds
    .map((round) => round.total)
    .filter((total): total is number => total !== null);
  const speeds = rounds
    .map((round) => round.speedWpm)
    .filter((speed): speed is number => speed !== null);

  const avg = (values: number[]) =>
    values.length === 0
      ? null
      : values.reduce((sum, value) => sum + value, 0) / values.length;
  const avgTotalValue = avg(totals);
  const avgSpeedValue = avg(speeds);

  // 趋势：时间正序取最近 5 轮（label 用全局时间序号，参照原型图"轮#N"）
  const timeAsc = [...rounds].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  const trend = timeAsc
    .map((round, index) => ({ round, label: `轮#${index + 1}` }))
    .filter(({ round }) => round.total !== null)
    .slice(-5)
    .map(({ round, label }) => ({ label, total: round.total as number }));

  return {
    roundCount: rounds.length,
    avgTotal: avgTotalValue === null ? null : Math.round(avgTotalValue * 10) / 10,
    avgSpeed: avgSpeedValue === null ? null : Math.round(avgSpeedValue),
    trend,
  };
}

// ========== 错词本派生（US2，data-model §2.3 / FR-006） ==========

export interface WeakWord {
  /** normalizeWord 去重键 */
  key: string;
  /** 首次出现时的展示词 */
  word: string;
  /** 最差档（poor < fair，clarify Q2） */
  worstQuality: "poor" | "fair";
  count: number;
  /** 连读/重读标注并集 */
  extras: WordExtra[];
}

export function deriveWeakWords(rounds: ProfileRound[]): WeakWord[] {
  const map = new Map<string, WeakWord>();
  for (const round of rounds) {
    for (const word of round.words) {
      const key = normalizeWord(word.word);
      if (!key) continue;
      const existing = map.get(key);
      if (!existing) {
        map.set(key, {
          key,
          word: word.word,
          worstQuality: word.quality,
          count: 1,
          extras: [...word.extras],
        });
        continue;
      }
      existing.count += 1;
      if (word.quality === "poor") existing.worstQuality = "poor";
      for (const extra of word.extras) {
        if (!existing.extras.includes(extra)) existing.extras.push(extra);
      }
    }
  }
  // count 降序；同频次最差档（poor）在前（SC-004）
  return [...map.values()].sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    if (a.worstQuality !== b.worstQuality) return a.worstQuality === "poor" ? -1 : 1;
    return 0;
  });
}
