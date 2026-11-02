"use client";

/**
 * 弹窗内存态与数据快照类型（003-pronunciation-info-popup）。
 *
 * - 数据快照类型：contracts/state-data.md（全部字段可缺省，前端 ?. + 空态分支，
 *   任何字段缺失不得抛错、不得白屏——FR-015）
 * - 收藏集：会话内存 Set（键 = polishedText），刷新清空，不做持久化（spec Assumptions）
 */

// ========== 数据快照类型（LangGraph state → 弹窗，只读派生） ==========

/** ise_check_results.pronunciation 元素（ise_analyze_node 产出，score 已归一化百分制） */
export interface PronunciationItem {
  word: string;
  score: number | null;
  comment: string;
}

/** ise_check_results.scores（XML 解析结果原样透出，SC-004 不做换算/四舍五入） */
export interface IseScores {
  total: number | null;
  accuracy: number | null;
  fluency: number | null;
  integrity: number | null;
}

/** ise_check_results（成功路径含 scores/speed_wpm；降级路径两者缺省 → 前端空态） */
export interface IseCheckResults {
  pronunciation?: PronunciationItem[];
  advice?: string;
  scores?: IseScores;
  speed_wpm?: number | null;
}

/** 单风格润色块（后端 polisher_schema.StylePolish） */
export interface StylePolish {
  polished_text: string;
  explanation: string;
}

/** polisher（PolisherOutput；polished_text/explanation = 地道美式默认风格） */
export interface PolisherSnapshot {
  original_text?: string;
  polished_text?: string;
  explanation?: string;
  polish_comment?: string;
  polish_status?: string; // success / fallback / failed / skipped
  style_business?: StylePolish | null;
  style_british?: StylePolish | null;
}

/** 弹窗打开时刻冻结的 state 快照（contracts/state-data.md 全字段可缺省） */
export interface PopupSnapshot {
  ise_check_results?: IseCheckResults | null;
  ise_grade?: number | null;
  ref_text?: string;
  /** 用户本轮朗读的 IAT 转写（OverAllState 既有 key）：示范读音第三兜底源——
   *  tutor 纠错轮次 polisher 不执行、ref_text 为空（自证模式）时，
   *  raw_text 是唯一能代表"用户读的那句"的文本（2026-11-02 实测补充） */
  raw_text?: string;
  polisher?: PolisherSnapshot | null;
  ise_status?: string;
}

// ========== 收藏内存态（会话级，不持久化） ==========

const favorites = new Set<string>();

export function isFavorite(key: string): boolean {
  return favorites.has(key);
}

/** 切换收藏态，返回切换后的状态（true=已收藏） */
export function toggleFavorite(key: string): boolean {
  if (favorites.has(key)) {
    favorites.delete(key);
    return false;
  }
  favorites.add(key);
  return true;
}
