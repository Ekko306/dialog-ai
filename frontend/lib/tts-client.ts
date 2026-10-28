"use client";

/**
 * TTS 旁路客户端（003 R2/FR-004/FR-012，契约见 specs/003/contracts/tts-bypass-contract.md）：
 * 点击发音按钮时按需调用 tutor 图的双入口旁路（tts_request: true），只合成语音、
 * 不调 LLM。走无状态 POST /api/runs/wait（实施修正：无需 thread id，
 * 旁路任务不残留到对话线程历史），输入输出契约不变：
 * input {tts_request, raw_text, corrections} → 终态 values.raw_audio / tutor_audio。
 */

export interface CorrectionInput {
  wrong: string;
  correct: string;
  type: string;
}

export interface TtsAudioResult {
  /** base64 解码后的音频 Blob；后端未产出/合成失败为 null */
  raw: Blob | null;
  correct: Blob | null;
}

export class TtsClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TtsClientError";
  }
}

/** 按 `{messageId}:{raw|correct}` 缓存已合成的 Blob URL，同句二次点击不重复合成 */
const blobUrlCache = new Map<string, string>();

export function getCachedAudioUrl(key: string): string | undefined {
  return blobUrlCache.get(key);
}

export function clearAudioCache(messageId?: string) {
  if (messageId === undefined) {
    for (const url of blobUrlCache.values()) URL.revokeObjectURL(url);
    blobUrlCache.clear();
    return;
  }
  for (const [key, url] of blobUrlCache) {
    if (key.startsWith(`${messageId}:`)) {
      URL.revokeObjectURL(url);
      blobUrlCache.delete(key);
    }
  }
}

/**
 * MIME 字节头探测（契约规定）：FF FB / 49 44 33 → audio/mpeg，52 49 46 46 → audio/wav，
 * 未识别默认 audio/mpeg。
 */
function detectMime(bytes: Uint8Array): string {
  if (bytes.length >= 3 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    return "audio/mpeg"; // "ID3"
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) {
    return "audio/mpeg"; // MPEG frame sync
  }
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46
  ) {
    return "audio/wav"; // "RIFF"
  }
  return "audio/mpeg";
}

function base64ToBlob(b64: string): Blob | null {
  try {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: detectMime(bytes) });
  } catch {
    return null;
  }
}

/** 后端 bytes 经 JSON 序列化的兼容解码：base64 字符串 / {"b64": "..."} / 字节数组 */
function decodeAudioField(value: unknown): Blob | null {
  if (value == null || value === "") return null;
  if (typeof value === "string") return base64ToBlob(value);
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeof obj.b64 === "string") return base64ToBlob(obj.b64);
    if (Array.isArray(value)) {
      const bytes = new Uint8Array(value as number[]);
      return new Blob([bytes], { type: detectMime(bytes) });
    }
  }
  return null;
}

/**
 * 请求 tutor 图 TTS 旁路合成原句 + 示范句两段音频。
 * 合成失败/空音频返回 null 字段，不抛错（FR-012 优雅降级，文案由调用方提示）；
 * 网络/服务异常抛 TtsClientError。
 */
export async function fetchTtsAudio(
  rawText: string,
  corrections: CorrectionInput[],
): Promise<TtsAudioResult> {
  const res = await fetch("/api/runs/wait", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      // TTS 旁路契约目标是 tutor 子图（langgraph.json 独立注册的 grammer_tutor）：
      // 父图 talk_agent 的 START→coach→HITL 主链没有 tts_request 入口，发父图会
      // 挂在 HITL 永远到不了 tts_node。默认直调子图，环境变量保留覆盖口。
      assistant_id: process.env.NEXT_PUBLIC_TTS_ASSISTANT_ID || "grammer_tutor",
      input: { tts_request: true, raw_text: rawText, corrections },
      stream_mode: "values",
    }),
  });
  if (!res.ok) {
    throw new TtsClientError(`TTS 服务请求失败（${res.status}）`);
  }
  // /runs/wait 响应顶层即终态 values 本体（无 "values" 包装，2026-10-26 实测）；
  // 兼容包装形态以防服务端版本差异
  const data = (await res.json()) as Record<string, unknown>;
  const values = (data.values ?? data) as Record<string, unknown>;
  return {
    raw: decodeAudioField(values.raw_audio),
    correct: decodeAudioField(values.tutor_audio),
  };
}

/**
 * 取原句/示范句音频的 Blob URL（带缓存）。返回 null 表示合成失败。
 * kind: raw=用户原句，correct=示范句（corrections 为空时后端按原句兜底，契约同款）。
 */
export async function getTtsAudioUrl(
  messageId: string,
  kind: "raw" | "correct",
  rawText: string,
  corrections: CorrectionInput[],
): Promise<string | null> {
  const key = `${messageId}:${kind}`;
  const cached = blobUrlCache.get(key);
  if (cached) return cached;

  const result = await fetchTtsAudio(rawText, corrections);
  const blob = kind === "raw" ? result.raw : (result.correct ?? result.raw);
  if (!blob) return null;

  const url = URL.createObjectURL(blob);
  // 两段一起缓存，另一段后续点击零请求
  if (result.raw) {
    const rawUrl = URL.createObjectURL(result.raw);
    blobUrlCache.set(`${messageId}:raw`, rawUrl);
  }
  if (result.correct) {
    const correctUrl = URL.createObjectURL(result.correct);
    blobUrlCache.set(`${messageId}:correct`, correctUrl);
  }
  return blobUrlCache.get(key) ?? url;
}
