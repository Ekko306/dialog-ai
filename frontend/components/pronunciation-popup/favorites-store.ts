"use client";

/**
 * 收藏 store（data-model §2.4 / contracts/local-storage.md §1，research R3）：
 * 003 弹窗内存 Set 升级为共享 localStorage 存储，弹窗与"我的"页面读写同一
 * 单例 → 双向同步（FR-009 / SC-006）。
 *
 * - useSyncExternalStore 订阅模式（同 use-popup-audio.ts）：listFavorites 返回
 *   缓存快照（引用稳定），变更时整体重建引用并通知；
 * - key 唯一（= 英文句子，沿用 003 键语义）；已存在再次收藏 → 刷新 savedAt 置顶；
 * - 解析失败/结构不符 → 视为空数组重建，不抛错（contracts §1 / FR-013）；
 * - 隐私模式降级内存态（safe-local-storage 封装承担，FR-012）。
 */

import { safeReadJson, safeWriteJson } from "@/lib/safe-local-storage";

export interface FavoriteItem {
  /** 唯一键 = 英文句子（003 polishedText） */
  key: string;
  /** 风格标签：american / business / british */
  style: string;
  en: string;
  zh: string;
  /** 收藏时间戳，列表按其倒序 */
  savedAt: number;
}

const STORAGE_KEY = "dialog-ai:profile:favorites";

const isFavoriteItem = (value: unknown): value is FavoriteItem => {
  if (value === null || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.key === "string" &&
    typeof obj.style === "string" &&
    typeof obj.en === "string" &&
    typeof obj.zh === "string" &&
    typeof obj.savedAt === "number"
  );
};

const load = (): FavoriteItem[] => {
  const raw = safeReadJson(STORAGE_KEY);
  return Array.isArray(raw) ? raw.filter(isFavoriteItem) : [];
};

let items: FavoriteItem[] = load();

/** 已排序快照（savedAt 倒序）；引用稳定，useSyncExternalStore getSnapshot 直接用 */
let snapshot: FavoriteItem[] = [...items].sort((a, b) => b.savedAt - a.savedAt);
const listeners = new Set<() => void>();

const commit = () => {
  snapshot = [...items].sort((a, b) => b.savedAt - a.savedAt);
  safeWriteJson(STORAGE_KEY, items);
  listeners.forEach((notify) => notify());
};

/** 列表快照（savedAt 倒序）；同时作为 useSyncExternalStore 的 getSnapshot */
export function listFavorites(): FavoriteItem[] {
  return snapshot;
}

/** 与 003 既有消费方（polish-section）签名兼容 */
export function isFavorite(key: string): boolean {
  return items.some((item) => item.key === key);
}

/** 已存在则刷新 savedAt 置顶 */
export function addFavorite(item: Omit<FavoriteItem, "savedAt">): void {
  const savedAt = Date.now();
  const index = items.findIndex((existing) => existing.key === item.key);
  if (index >= 0) {
    items[index] = { ...item, savedAt };
  } else {
    items = [{ ...item, savedAt }, ...items];
  }
  commit();
}

export function removeFavorite(key: string): void {
  items = items.filter((item) => item.key !== key);
  commit();
}

export function subscribeFavorites(notify: () => void): () => void {
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
  };
}
