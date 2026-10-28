"use client";

/**
 * 007 发音评测旁路客户端（lib 层，无 React 依赖）。
 *
 * 端点契约：frontend/specs/007-pronunciation-analysis/contracts/evaluate-endpoint-contract.md
 * 数据模型：frontend/specs/007-pronunciation-analysis/data-model.md
 *
 * 与 003/004/006 的 /runs/wait 直调旁路不同，评测是纯工具调用（讯飞 ISE，
 * 无图参与），走 webapp.py 的 POST /api/audio/evaluate（octet-stream PCM +
 * ref_text query）。双缓存均为模块级 Map（会话内存，刷新即清）：
 * - recordingStore：转写文本 → 本轮录音 PCM（dictation stop 成功后写入，
 *   面板按 raw_text 查，data-model.md「组件数据流」）
 * - evaluationCache：messageId → 最近一次评测结果（首评/重读成功后写入，
 *   重读覆盖写，仅面板消费，不回写气泡/线程，FR-005）
 */

export interface EvaluationWord {
  /** 原句分词（XML word/@content） */
  word: string;
  /** 百分制逐词分；无逐词分为 null（不着色不编造，FR-008） */
  score: number | null;
  /** 异常标记（"漏读"/"增读"/"回读"/"替换"/"音素异常"） */
  flags: string[];
}

export interface EvaluationResult {
  /** 综合评分（百分制） */
  total: number | null;
  /** 发音分 */
  accuracy: number | null;
  /** 流利度 */
  fluency: number | null;
  /** 完整度 */
  integrity: number | null;
  /** 读的内容与参考句不符 → 分数无效 */
  is_rejected: boolean;
  words: EvaluationWord[];
}

/** 评测失败（请求/响应/被拒统一形态），message 直接可展示 */
export class EvaluationError extends Error {}

/** 评测被拒（is_rejected / 关键分数缺失）固定文案（契约「前端消费规则」） */
export const EVALUATION_REJECTED_MESSAGE = "评测未通过：请按参考句重新朗读";

export const recordingStore = new Map<string, ArrayBuffer>();
export const evaluationCache = new Map<string, EvaluationResult>();

/** 按需评测：裸 PCM（16kHz/16bit/单声道/小端）+ 被评测句（用户原句）→ EvaluationResult */
export async function fetchEvaluation(
  pcm: ArrayBuffer,
  refText: string,
): Promise<EvaluationResult> {
  let response: Response;
  try {
    response = await fetch(`/api/audio/evaluate?ref_text=${encodeURIComponent(refText)}`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: pcm,
    });
  } catch {
    throw new EvaluationError("评测请求失败，请检查网络后重试");
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { detail?: string } | null;
    throw new EvaluationError(body?.detail || `评测失败（${response.status}）`);
  }
  const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!data) throw new EvaluationError("评测响应解析失败，请重试");
  if (data.is_rejected === true || data.total == null) {
    throw new EvaluationError(EVALUATION_REJECTED_MESSAGE);
  }
  // 边界防御：字段缺失/类型不符一律归 null / 空数组，不伪造（FR-008）
  const rawWords = Array.isArray(data.words) ? data.words : [];
  return {
    total: typeof data.total === "number" ? data.total : null,
    accuracy: typeof data.accuracy === "number" ? data.accuracy : null,
    fluency: typeof data.fluency === "number" ? data.fluency : null,
    integrity: typeof data.integrity === "number" ? data.integrity : null,
    is_rejected: false,
    words: rawWords
      .map((w) => {
        const item = (w ?? {}) as Record<string, unknown>;
        return {
          word: typeof item.word === "string" ? item.word : "",
          score: typeof item.score === "number" ? item.score : null,
          flags: Array.isArray(item.flags)
            ? item.flags.filter((f): f is string => typeof f === "string")
            : [],
        };
      })
      // 讯飞 ISE 在词序列首尾插入 sil（静音/停顿标记），非真实单词，逐词视图不展示
      .filter((w) => w.word.trim().toLowerCase() !== "sil"),
  };
}
