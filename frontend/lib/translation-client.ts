"use client";

/**
 * 翻译旁路客户端（004 R1/R2/R3，契约见 specs/004-correction-translation/contracts/translation-bypass-contract.md）：
 * 点击「文A」按钮时按需调用 tutor 图的三入口旁路（translate_request: true），只翻译、
 * 不调讲解 LLM、不合成语音。走无状态 POST /api/runs/wait（同 003 TTS 旁路：无需 thread id，
 * 旁路任务不残留到对话线程历史），输入输出契约：
 * input {translate_request, raw_text} → 终态 values.translation。
 * 译文为确定性内容：模块级 Map 按 messageId 缓存，同会话重复查看零请求（FR-005/US3）。
 */

export class TranslationClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TranslationClientError";
  }
}

/** 按 messageId 缓存已获取的译文（译文确定性内容，无一致性风险），同会话重复展开零请求 */
const translationCache = new Map<string, string>();

export function getCachedTranslation(messageId: string): string | undefined {
  return translationCache.get(messageId);
}

export function clearTranslationCache() {
  translationCache.clear();
}

/**
 * 请求 tutor 图翻译旁路，返回原句中文译文。
 * 空串译文原样返回（后端失败/空输入兜底为 ""，不抛错——FR-003 失败态由调用方渲染）；
 * 网络/服务异常抛 TranslationClientError。
 */
export async function fetchTranslation(rawText: string): Promise<string> {
  const res = await fetch("/api/runs/wait", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      // 翻译旁路契约目标是 tutor 子图（langgraph.json 独立注册的 grammer_tutor）：
      // 父图 talk_agent 的 START→coach→HITL 主链没有 translate_request 入口，发父图会
      // 挂在 HITL 永远到不了 translate_node。与 TTS 旁路共用覆盖口（同一子图）。
      assistant_id: process.env.NEXT_PUBLIC_TTS_ASSISTANT_ID || "grammer_tutor",
      input: { translate_request: true, raw_text: rawText },
      stream_mode: "values",
    }),
  });
  if (!res.ok) {
    throw new TranslationClientError(`翻译服务请求失败（${res.status}）`);
  }
  // /runs/wait 响应顶层即终态 values 本体（无 "values" 包装，2026-10-26 实测）；
  // 兼容包装形态以防服务端版本差异（写法同 tts-client.ts）
  const data = (await res.json()) as Record<string, unknown>;
  const values = (data.values ?? data) as Record<string, unknown>;
  const translation = values.translation;
  return typeof translation === "string" ? translation : "";
}

/**
 * 取原句译文（带缓存）。缓存命中直接返回（零请求，US3）；
 * 未命中发起旁路请求，成功后写入缓存。空译文不写缓存（允许重试）。
 */
export async function getTranslation(
  messageId: string,
  rawText: string,
): Promise<string> {
  const cached = translationCache.get(messageId);
  if (cached !== undefined) return cached;

  const translation = await fetchTranslation(rawText);
  // 空串 = 后端失败/空输入，不缓存以便重试；非空才视为成功结果
  if (translation) translationCache.set(messageId, translation);
  return translation;
}
