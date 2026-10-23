"use client";

import { useEffect } from "react";

import { useSceneStore } from "@/lib/scene-store";

/**
 * 场景应用反馈 toast（FR-013）：
 * - applyError：失败提示（destructive 红色）
 * - applyNotice：中性提示（如"暂存待生效"，浅色样式）
 * 读 scene-store 的轻量自绘 toast，约 3s 自动消失并清除对应状态。
 * 项目无 toast 基建，不自造依赖。
 */
export function SceneApplyToast() {
  const applyError = useSceneStore((s) => s.applyError);
  const clearApplyError = useSceneStore((s) => s.clearApplyError);
  const applyNotice = useSceneStore((s) => s.applyNotice);
  const clearApplyNotice = useSceneStore((s) => s.clearApplyNotice);

  useEffect(() => {
    if (!applyError) return;
    const timer = window.setTimeout(() => clearApplyError(), 3000);
    return () => window.clearTimeout(timer);
  }, [applyError, clearApplyError]);

  useEffect(() => {
    if (!applyNotice) return;
    const timer = window.setTimeout(() => clearApplyNotice(), 3000);
    return () => window.clearTimeout(timer);
  }, [applyNotice, clearApplyNotice]);

  if (!applyError && !applyNotice) return null;

  return applyError ? (
    <div
      role="alert"
      className="bg-destructive text-primary-foreground fixed bottom-24 left-1/2 z-[60] -translate-x-1/2 rounded-full px-4 py-2 text-sm whitespace-nowrap shadow-md"
    >
      {applyError}
    </div>
  ) : (
    <div
      role="status"
      className="bg-secondary text-foreground border-border fixed bottom-24 left-1/2 z-[60] -translate-x-1/2 rounded-full border px-4 py-2 text-sm whitespace-nowrap shadow-md"
    >
      {applyNotice}
    </div>
  );
}
