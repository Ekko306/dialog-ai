"use client";

/**
 * 按需润色旁路客户端（006 R1/R2/R3，契约见 specs/006-idiom-panel/contracts/polisher-bypass-contract.md）：
 * 纠错气泡「地道」入口点击时按需直调 langgraph.json 独立注册的 polisher 子图，
 * 只润色、不合成语音（不传 enable_tts，tts_node 默认跳过）。走无状态
 * POST /api/runs/wait（同 003 TTS / 004 翻译旁路：无需 thread id，不残留对话线程），
 * 输入输出契约：input {raw_text: <纠正句>} → 终态 values.polisher（六字段字典）。
 * 结果按 messageId 会话级缓存（R3，同 004 translation-client 模式）；失败不缓存允许重试。
 *
 * 面板 AI 发音（纠错面板专用，R2）：复用 tts-client 导出的 fetchTtsAudio 走
 * grammer_tutor TTS 旁路合成润色句，Blob URL 存本模块自有 panelAudioCache——
 * 禁止经 getTtsAudioUrl（其全局键 `${messageId}:correct` 已被纠错气泡示范句占用，
 * 混用会覆盖导致气泡本体发音播错句）。
 */

import { fetchTtsAudio } from "@/lib/tts-client";

export interface OnDemandPolish {
  polished_text: string;
  explanation: string;
}

export class PolisherBypassError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolisherBypassError";
  }
}

/** 按 messageId 缓存按需润色结果（success/fallback 写入；skipped/失败不写允许重试，FR-006/FR-007） */
const onDemandCache = new Map<string, OnDemandPolish>();

export function getCachedOnDemandPolish(messageId: string): OnDemandPolish | undefined {
  return onDemandCache.get(messageId);
}

/**
 * 直调 polisher 子图按需润色纠正句（FR-005）。
 * fallback（服务降级保留原文）视为确定性结果照常返回；skipped（空输入兜底）
 * 与未知状态按失败处理抛 PolisherBypassError；网络/服务异常同抛。
 */
export async function fetchOnDemandPolish(correctedSentence: string): Promise<OnDemandPolish> {
  const res = await fetch("/api/runs/wait", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      assistant_id: process.env.NEXT_PUBLIC_POLISHER_ASSISTANT_ID || "polisher",
      input: { raw_text: correctedSentence },
      stream_mode: "values",
    }),
  });
  if (!res.ok) {
    throw new PolisherBypassError(`润色服务请求失败（${res.status}）`);
  }
  // /runs/wait 响应顶层即终态 values 本体（无 "values" 包装，2026-10-26 实测）；
  // 兼容包装形态以防服务端版本差异（写法同 tts-client.ts / translation-client.ts）
  const data = (await res.json()) as Record<string, unknown>;
  const values = (data.values ?? data) as Record<string, unknown>;
  const polisher = (values.polisher ?? {}) as Record<string, unknown>;
  const status = typeof polisher.polish_status === "string" ? polisher.polish_status : "";
  const polished = typeof polisher.polished_text === "string" ? polisher.polished_text : "";
  const explanation = typeof polisher.explanation === "string" ? polisher.explanation : "";
  if ((status !== "success" && status !== "fallback") || !polished) {
    throw new PolisherBypassError("润色服务暂不可用");
  }
  return { polished_text: polished, explanation };
}

/** 取按需润色结果（带缓存，FR-007）：命中零请求；未命中请求成功后写缓存 */
export async function getOnDemandPolish(
  messageId: string,
  correctedSentence: string,
): Promise<OnDemandPolish> {
  const cached = onDemandCache.get(messageId);
  if (cached) return cached;
  const result = await fetchOnDemandPolish(correctedSentence);
  onDemandCache.set(messageId, result);
  return result;
}

/** 面板发音音频缓存（键 = `${messageId}:panel-polish`），与 tts-client 全局缓存键隔离（R2） */
const panelAudioCache = new Map<string, string>();

/**
 * 获取纠错面板润色句发音 Blob URL（懒加载，R2）。
 * 复用 grammer_tutor TTS 旁路（fetchTtsAudio 直接调用，不写其全局缓存）：
 * 伪条目 correct 位音频即润色句。返回 null = 合成失败（调用方轻提示）。
 */
export async function getPanelPolishAudioUrl(
  messageId: string,
  correctedSentence: string,
  polishedText: string,
): Promise<string | null> {
  const key = `${messageId}:panel-polish`;
  const cached = panelAudioCache.get(key);
  if (cached) return cached;
  const result = await fetchTtsAudio(correctedSentence, [
    { wrong: correctedSentence, correct: polishedText, type: "polish" },
  ]);
  const blob = result.correct ?? result.raw;
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  panelAudioCache.set(key, url);
  return url;
}
