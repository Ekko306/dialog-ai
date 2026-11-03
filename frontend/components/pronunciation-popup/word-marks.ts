/**
 * 逐词标注派生（data-model §2.1 / research.md R2）：前端视图层两级推导，后端零改动。
 *
 * 1. 三档质量：ise_check_results.pronunciation[].score 阈值映射
 *    （score < 60 待提高、60 ≤ score < 85 小瑕疵、score ≥ 85 很完美；
 *    score == null 不标注——FR-015 不虚构数值）；
 * 2. 连读/重读：comment 中文点评关键词命中（"连读"/"重读"），可叠加，默认 []。
 * 阈值常量集中在本文件，便于调参（research.md R2）。
 */

import type { PronunciationItem } from "./popup-store";

export type WordQuality = "poor" | "fair" | "good"; // 待提高 / 小瑕疵 / 很完美
export type WordExtra = "liaison" | "stress"; // 连读 / 重读词（可叠加）

export interface WordMark {
  /** 展示词（原句对齐时还原标点与大小写；对不上时用评测词原样） */
  word: string;
  /** score 三档映射；score == null → null（不标注） */
  quality: WordQuality | null;
  /** comment 关键词命中，默认 [] */
  extras: WordExtra[];
}

// 三档阈值常量（调参只改这里）
export const QUALITY_THRESHOLDS = {
  /** score ≥ 85 → 很完美 */
  good: 85,
  /** 60 ≤ score < 85 → 小瑕疵；score < 60 → 待提高 */
  fair: 60,
} as const;

export function qualityOf(score: number | null | undefined): WordQuality | null {
  if (score == null) return null;
  if (score >= QUALITY_THRESHOLDS.good) return "good";
  if (score >= QUALITY_THRESHOLDS.fair) return "fair";
  return "poor";
}

export function extrasOf(comment: string | null | undefined): WordExtra[] {
  const extras: WordExtra[] = [];
  if (comment?.includes("连读")) extras.push("liaison");
  if (comment?.includes("重读")) extras.push("stress");
  return extras;
}

/** 词干归一化：剥离标点/空格，不区分大小写（对齐用）；profile-aggregate 错词本去重键复用（R8 禁止复制） */
export const normalizeWord = (word: string): string => word.replace(/[^a-zA-Z']/g, "").toLowerCase();

/**
 * 静音/停顿标记过滤（2026-11-02 真实样本核对）：讯飞 ISE 的 word 序列会插入
 * "sil"（静音段）等非朗读 token（本例 19 词出现 2 个 sil，S6 比对发现），
 * 原型图逐词区只显示真实朗读词，故派生前滤除。
 */
export const SILENCE_TOKENS = new Set(["sil", "sp", "pause"]);

/**
 * 逐词标注主入口：ise_check_results.pronunciation → WordMark[]。
 *
 * sentence（ref_text || polisher.original_text || raw_text）存在时按词切分对齐，
 * 还原标点与大小写（原型图："Recently," / "English."）；数量一致直接按位对齐，
 * 不一致时按词干匹配尽力还原，对不上用评测词原样——不对齐不阻塞（R2 近似推导）。
 */
export function deriveWordMarks(
  pronunciation: PronunciationItem[] | null | undefined,
  sentence?: string | null,
): WordMark[] {
  const realWords = (pronunciation ?? []).filter(
    (item) => !SILENCE_TOKENS.has(normalizeWord(item.word)),
  );
  if (!realWords.length) return [];
  const marks: WordMark[] = realWords.map((item) => ({
    word: item.word,
    quality: qualityOf(item.score),
    extras: extrasOf(item.comment),
  }));

  const tokens = (sentence ?? "").trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return marks;

  if (tokens.length === marks.length) {
    return marks.map((mark, index) => ({ ...mark, word: tokens[index] ?? mark.word }));
  }
  const used = new Set<number>();
  return marks.map((mark) => {
    const target = normalizeWord(mark.word);
    const index = tokens.findIndex((token, i) => !used.has(i) && normalizeWord(token) === target);
    if (index >= 0) {
      used.add(index);
      return { ...mark, word: tokens[index] ?? mark.word };
    }
    return mark;
  });
}
