"use client";

import { create } from "zustand";

/**
 * 全局音频管理器（003 FR-005/R3）：
 * 整页同一时刻最多一段音频在播（含跟读面板），模块级单例 HTMLAudioElement
 * 保证互斥——任何 play() 先 stop 当前源。进度/倍速/循环全部走原生能力：
 * playbackRate 即时生效，loop 属性原生自动重播（analyze F4 决议）。
 */

export type AudioStatus = "idle" | "loading" | "playing" | "paused";

/**
 * 播放源标识：`{messageId}:raw`（用户原句）/ `{messageId}:correct`（示范句）/
 * `{messageId}:panel`（跟读面板，与 correct 同一段音频的独立入口）。
 * sourceId 是全局互斥与按钮态的锚点：status 由当前 sourceId 的持有者消费。
 */
export type AudioSourceId = string;

interface AudioPlaybackStore {
  sourceId: AudioSourceId | null;
  status: AudioStatus;
  blobUrl: string | null;
  rate: number;
  loop: boolean;
  currentTime: number;
  duration: number;
  play: (sourceId: AudioSourceId, blobUrl: string) => Promise<void>;
  stop: () => void;
  pause: () => void;
  resume: () => void;
  setRate: (rate: number) => void;
  setLoop: (loop: boolean) => void;
}

// 浏览器端惰性单例（SSR 安全：模块加载时不触碰 window）
let singleton: HTMLAudioElement | null = null;

function getAudioElement(): HTMLAudioElement {
  if (singleton) return singleton;
  const el = new Audio();
  el.preload = "auto";
  singleton = el;
  return el;
}

export const useAudioPlayback = create<AudioPlaybackStore>((set, get) => ({
  sourceId: null,
  status: "idle",
  blobUrl: null,
  rate: 1.0,
  loop: false,
  currentTime: 0,
  duration: 0,

  play: async (sourceId, blobUrl) => {
    const el = getAudioElement();
    const prev = get();

    // 同一源重复点击：playing → 暂停（再点恢复），paused → 续播
    if (prev.sourceId === sourceId && prev.blobUrl === blobUrl) {
      if (prev.status === "playing") {
        el.pause();
        set({ status: "paused" });
        return;
      }
      if (prev.status === "paused") {
        await el.play().catch(() => set({ status: "paused" }));
        set({ status: "playing" });
        return;
      }
    }

    // 互斥（FR-005）：先停掉当前源再换新源
    el.pause();
    set({
      sourceId,
      blobUrl,
      status: "playing",
      currentTime: 0,
      duration: 0,
      // 倍速/循环是全局偏好，跨源保留
    });
    el.src = blobUrl;
    el.playbackRate = get().rate;
    el.loop = get().loop;
    await el.play().catch(() => set({ status: "idle" }));
  },

  stop: () => {
    const el = getAudioElement();
    el.pause();
    el.removeAttribute("src");
    set({ sourceId: null, status: "idle", blobUrl: null, currentTime: 0, duration: 0 });
  },

  pause: () => {
    getAudioElement().pause();
    set({ status: "paused" });
  },

  resume: () => {
    const el = getAudioElement();
    if (get().status !== "paused") return;
    el.play().catch(() => set({ status: "paused" }));
    set({ status: "playing" });
  },

  setRate: (rate) => {
    getAudioElement().playbackRate = rate;
    set({ rate });
  },

  setLoop: (loop) => {
    getAudioElement().loop = loop;
    set({ loop });
  },
}));

/**
 * 把单例的媒体事件同步进 zustand（模块加载即挂接，仅浏览器执行）。
 * ended：loop 开启时浏览器原生重播、状态保持 playing；关闭时归位 idle。
 */
if (typeof window !== "undefined") {
  const el = getAudioElement();
  const sync = () => {
    const s = useAudioPlayback.getState();
    if (!s.sourceId) return;
    useAudioPlayback.setState({
      currentTime: el.currentTime,
      duration: Number.isFinite(el.duration) ? el.duration : 0,
    });
  };
  el.addEventListener("timeupdate", sync);
  el.addEventListener("loadedmetadata", sync);
  el.addEventListener("durationchange", sync);
  el.addEventListener("ended", () => {
    const s = useAudioPlayback.getState();
    if (!s.sourceId) return;
    if (!el.loop) {
      useAudioPlayback.setState({ status: "idle", currentTime: 0 });
    }
  });
}
