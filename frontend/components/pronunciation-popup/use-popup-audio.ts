"use client";

import { useSyncExternalStore } from "react";

import { getSettings } from "@/lib/profile-settings";

import { getLastRecording, pcmToWavBlob } from "@/components/server-dictation-adapter";

/**
 * 弹窗单例播放器（contracts/audio-tts.md §4）：
 * - 演示读音（英音/美音/AI 朗读）经 POST /api/audio/tts 按需合成，按 (text, accent)
 *   做内存 Map 缓存（objectURL 复用，弹窗生命周期内去重）；
 * - "我的"回放读最近一轮录音内存槽（server-dictation-adapter，R4）→ WAV Blob；
 * - 同一时刻只播一个源：新播放打断旧播放（含打断进行中的合成请求）；
 * - loop 开关 = audio.loop（循环跟读不重复发请求）；stop/cleanup 供关闭弹窗清理
 *   （FR-014：停止播放、loop 复位、revokeObjectURL）；
 * - 错误状态外显（FR-015 不静默失败），由按钮区渲染提示。
 *
 * 引擎状态放在模块级（真正单例）：逐词区/润色区各自调用本 hook 共享同一个
 * <audio> 与缓存；通过 useSyncExternalStore 订阅状态变化触发重渲染。
 */

export type TtsAccent = "american" | "british";

/** 播放源：示范/润色朗读（按需 TTS）或用户本轮录音回放 */
export type PlaySource = { kind: "tts"; text: string; accent: TtsAccent } | { kind: "recording" };

export type AudioStatus = "idle" | "loading" | "playing";

export interface PopupAudioApi {
  readonly status: AudioStatus;
  /** 当前加载/播放中的源 key（按钮激活/置灰判定用） */
  readonly activeKey: string | null;
  /** 最近一次失败提示；下次 play 自动清除（FR-015） */
  readonly error: string | null;
  readonly loop: boolean;
  setLoop: (value: boolean) => void;
  /** opts.loop 可按次覆盖循环设置（如消息播放按钮恒为单次播放，不走 loopDefault） */
  play: (source: PlaySource, opts?: { loop?: boolean }) => void;
  stop: () => void;
  /** ↻重读：重放最近一次成功合成的示范音频（优先缓存）；本会话无记录时
   * 用 fallback 源先合成再播（契约 §4），两者皆缺 → 提示 */
  replayLastDemo: (fallback?: PlaySource) => void;
  /** 弹窗卸载清理：停止播放 + revoke 全部缓存 URL（FR-014） */
  cleanup: () => void;
}

interface EngineState {
  status: AudioStatus;
  activeKey: string | null;
  error: string | null;
  loop: boolean;
}

// loop 初值读设置默认（004 R5：模块初始化读取一次，弹窗内切换不回写设置）
const INITIAL_STATE: EngineState = {
  status: "idle",
  activeKey: null,
  error: null,
  loop: getSettings().loopDefault,
};

let state: EngineState = INITIAL_STATE;
const listeners = new Set<() => void>();

const setState = (patch: Partial<EngineState>) => {
  state = { ...state, ...patch };
  listeners.forEach((notify) => notify());
};

const subscribe = (notify: () => void) => {
  listeners.add(notify);
  return () => listeners.delete(notify);
};

const getSnapshot = () => state;

// ========== 引擎内部（模块级单例） ==========

const urlCache = new Map<string, string>(); // TTS 源 key → objectURL（cleanup 时统一 revoke）
let recordingUrl: string | null = null; // 录音回放 URL：每轮新建并覆盖 revoke（不能按固定 key 缓存）
let audioEl: HTMLAudioElement | null = null;
let playSeq = 0; // 自增序号：新播放/停止使旧的异步合成结果失效
let lastDemoSource: PlaySource | null = null; // 最近一次成功合成的示范源（↻重读用）

const sourceKeyOf = (source: PlaySource): string =>
  source.kind === "recording" ? "recording" : `tts:${source.accent}:${source.text}`;

/** TTS 源 key（消费方判定按钮激活态用，与引擎 sourceKeyOf 同规则） */
export const ttsSourceKey = (accent: TtsAccent, text: string): string => `tts:${accent}:${text}`;

const ensureAudio = (): HTMLAudioElement => {
  if (!audioEl) {
    audioEl = new Audio();
    audioEl.addEventListener("ended", () => {
      // loop=true 时浏览器自动循环，ended 不触发；非循环播完回 idle
      if (state.status === "playing") setState({ status: "idle", activeKey: null });
    });
    audioEl.addEventListener("error", () => {
      if (state.status !== "idle") {
        setState({ status: "idle", activeKey: null, error: "音频播放失败，请重试" });
      }
    });
  }
  return audioEl;
};

const fetchTtsUrl = async (text: string, accent: TtsAccent): Promise<string> => {
  const response = await fetch("/api/audio/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, accent }),
  });
  if (!response.ok) {
    // 透出后端 detail（如 british 口音未配置），供按钮区错误提示（FR-015）
    let detail = `tts failed: ${response.status}`;
    try {
      const body = (await response.json()) as { detail?: string };
      if (body?.detail) detail = body.detail;
    } catch {
      // 响应体非 JSON 时保持默认 detail
    }
    throw new Error(detail);
  }
  const blob = await response.blob();
  return URL.createObjectURL(blob);
};

const resolveUrl = async (source: PlaySource): Promise<string> => {
  const key = sourceKeyOf(source);
  if (source.kind === "recording") {
    // 录音槽内容随每轮覆盖，固定 key 缓存会命中过期 URL → 每轮新建并 revoke 旧的
    const pcm = getLastRecording();
    if (!pcm) throw new Error("暂无录音，请先朗读一轮");
    if (recordingUrl) URL.revokeObjectURL(recordingUrl);
    recordingUrl = URL.createObjectURL(pcmToWavBlob(pcm));
    return recordingUrl;
  }

  const cached = urlCache.get(key);
  if (cached) return cached;
  const url = await fetchTtsUrl(source.text, source.accent);
  urlCache.set(key, url);
  return url;
};

const play = (source: PlaySource, opts?: { loop?: boolean }) => {
  const key = sourceKeyOf(source);
  const seq = ++playSeq;

  setState({ status: "loading", activeKey: key, error: null });

  void (async () => {
    try {
      const url = await resolveUrl(source);
      if (seq !== playSeq) return; // 已被新播放/停止/清理取代
      const audio = ensureAudio();
      if (source.kind === "tts") lastDemoSource = source;
      audio.loop = opts?.loop ?? state.loop;
      audio.src = url;
      await audio.play();
      if (seq !== playSeq) return;
      setState({ status: "playing", activeKey: key });
    } catch (error) {
      if (seq !== playSeq) return;
      const message = error instanceof Error ? error.message.trim() : "";
      setState({
        status: "idle",
        activeKey: null,
        // 无录音 / 后端 detail（如 british 口音未配置）优先透出；其余用通用文案
        error:
          message.includes("暂无") || message.includes("tts failed") || message.includes("failed:")
            ? message
            : "语音合成失败，请稍后重试",
      });
    }
  })();
};

const stop = () => {
  playSeq += 1; // 使进行中的合成请求失效
  if (audioEl) audioEl.pause();
  setState({ status: "idle", activeKey: null });
};

const setLoop = (value: boolean) => {
  setState({ loop: value });
  if (audioEl) audioEl.loop = value;
};

const replayLastDemo = (fallback?: PlaySource) => {
  const source = lastDemoSource ?? fallback;
  if (!source) {
    setState({ error: "暂无可重读的示范音频" });
    return;
  }
  play(source);
};

const cleanup = () => {
  playSeq += 1;
  if (audioEl) audioEl.pause();
  for (const url of urlCache.values()) URL.revokeObjectURL(url);
  urlCache.clear();
  if (recordingUrl) URL.revokeObjectURL(recordingUrl);
  recordingUrl = null;
  lastDemoSource = null;
  state = INITIAL_STATE;
  listeners.forEach((notify) => notify());
};

// ========== Hook（稳定 api 对象，getter 实时读引擎状态） ==========

const api: PopupAudioApi = {
  get status() {
    return state.status;
  },
  get activeKey() {
    return state.activeKey;
  },
  get error() {
    return state.error;
  },
  get loop() {
    return state.loop;
  },
  setLoop,
  play,
  stop,
  replayLastDemo,
  cleanup,
};

/** 弹窗内取单例播放器；状态变化触发重渲染（getter 读取渲染时最新值） */
export function usePopupAudio(): PopupAudioApi {
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return api;
}
