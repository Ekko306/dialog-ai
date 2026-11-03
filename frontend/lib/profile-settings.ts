/**
 * 设置 store（data-model §2.5 / contracts/local-storage.md §2）：
 * ProfileSettings { accent, loopDefault, ttsEnabled }，localStorage 持久化 +
 * useSyncExternalStore 订阅（模式同 use-popup-audio.ts 单例 store）。
 *
 * - getSettings() 同步读：懒加载缓存；部分字段缺失与默认值合并（渐进兼容），
 *   解析失败/结构不符 → 全默认（contracts §2）；
 * - updateSettings(patch) 合并写入 + 持久化 + 通知订阅者（改动即时生效，SC-005）；
 * - 隐私模式降级内存态（safe-local-storage 封装承担，FR-012）。
 */

import { safeReadJson, safeWriteJson } from "@/lib/safe-local-storage";

export interface ProfileSettings {
  /** 默认口音，三处发声入口统一读取（research R4） */
  accent: "american" | "british";
  /** 循环跟读默认开启：use-popup-audio 模块初始化读取一次（R5，弹窗内切换不回写） */
  loopDefault: boolean;
  /** TTS 语音输出开关：false 时前端自动应答 audio_choice interrupt 为 no（R6） */
  ttsEnabled: boolean;
}

export const DEFAULT_SETTINGS: ProfileSettings = {
  accent: "american",
  loopDefault: false,
  ttsEnabled: true,
};

const STORAGE_KEY = "dialog-ai:profile:settings";

let cached: ProfileSettings | null = null;
const listeners = new Set<() => void>();

/** 结构校验 + 字段级兜底：任一字段缺失/类型不符 → 该字段取默认值 */
const coerce = (raw: unknown): ProfileSettings => {
  if (raw === null || typeof raw !== "object") return { ...DEFAULT_SETTINGS };
  const obj = raw as Record<string, unknown>;
  return {
    accent:
      obj.accent === "british" || obj.accent === "american"
        ? obj.accent
        : DEFAULT_SETTINGS.accent,
    loopDefault:
      typeof obj.loopDefault === "boolean" ? obj.loopDefault : DEFAULT_SETTINGS.loopDefault,
    ttsEnabled:
      typeof obj.ttsEnabled === "boolean" ? obj.ttsEnabled : DEFAULT_SETTINGS.ttsEnabled,
  };
};

/** 同步读取（懒加载缓存；返回引用在两次写入间保持稳定，供 useSyncExternalStore 用） */
export function getSettings(): ProfileSettings {
  if (cached === null) {
    cached = coerce(safeReadJson(STORAGE_KEY));
  }
  return cached;
}

export function updateSettings(patch: Partial<ProfileSettings>): void {
  cached = { ...getSettings(), ...patch };
  safeWriteJson(STORAGE_KEY, cached);
  listeners.forEach((notify) => notify());
}

export function subscribeSettings(notify: () => void): () => void {
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
  };
}
