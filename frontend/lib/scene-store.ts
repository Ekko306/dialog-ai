"use client";

/**
 * 场景 UI 状态（data-model.md §4 SceneUiState）：
 * - pendingScene：待应用场景。弹窗点击卡片写入；SceneApplier 成功 respond 后清除。
 * - applyError：最近一次应用失败提示（FR-013）；toast 展示后可清除。
 * - applyNotice：中性提示（如"暂存待生效"）。无 interrupt 时指令暂存（plan R3），
 *   此时不是失败而是延迟生效，需可感知反馈（FR-013 精神）。
 * 纯内存态不持久化——场景真值以后端 LangGraph Store 为准（FR-014）。
 * 状态转移：null --点击卡片--> pendingScene --respond成功--> null（已生效）
 *           pendingScene --respond失败--> applyError（pending 清空，保留当前生效场景）
 *           pendingScene --无 interrupt--> applyNotice（pending 保留，待 interrupt 自动补发）
 */
import { create } from "zustand";
import type { SceneCatalogEntry } from "@/lib/scene-catalog";

export interface PendingScene {
  role: string;
  scenario: string;
}

interface SceneUiState {
  pendingScene: PendingScene | null;
  applyError: string | null;
  applyNotice: string | null;
  requestScene: (entry: Pick<SceneCatalogEntry, "role" | "scenario">) => void;
  clearPending: () => void;
  setApplyError: (message: string) => void;
  clearApplyError: () => void;
  setApplyNotice: (message: string) => void;
  clearApplyNotice: () => void;
}

export const useSceneStore = create<SceneUiState>((set) => ({
  pendingScene: null,
  applyError: null,
  applyNotice: null,
  requestScene: (entry) => set({ pendingScene: { role: entry.role, scenario: entry.scenario } }),
  clearPending: () => set({ pendingScene: null }),
  setApplyError: (message) => set({ applyError: message }),
  clearApplyError: () => set({ applyError: null }),
  setApplyNotice: (message) => set({ applyNotice: message }),
  clearApplyNotice: () => set({ applyNotice: null }),
}));
