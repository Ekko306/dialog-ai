"use client";

import { useEffect } from "react";

import { getSettings, subscribeSettings } from "@/lib/profile-settings";

/**
 * 亮暗模式应用器（我的-设置 → 外观模式）：
 * 全局唯一挂载点（layout），订阅 profile-settings 与系统配色变化，把
 * settings.theme 翻译为 <html> 的 .dark 类（globals.css 的暗色变量全部挂在该类下）。
 * system 模式跟随 prefers-color-scheme 实时联动。
 * 首屏防闪烁由 layout 的内联脚本承担（优先于首帧渲染执行），本组件负责水合后的
 * 实时更新；两者判定规则保持一致，改动时需同步修改 layout 内联脚本。
 */

const isSystemDark = (): boolean => window.matchMedia("(prefers-color-scheme: dark)").matches;

const resolveIsDark = (mode: string): boolean =>
  mode === "dark" || (mode === "system" && isSystemDark());

export function applyThemeFromSettings(): void {
  document.documentElement.classList.toggle("dark", resolveIsDark(getSettings().theme));
}

export function ThemeApplier() {
  useEffect(() => {
    applyThemeFromSettings();
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const unsubscribe = subscribeSettings(applyThemeFromSettings);
    mq.addEventListener("change", applyThemeFromSettings);
    return () => {
      unsubscribe();
      mq.removeEventListener("change", applyThemeFromSettings);
    };
  }, []);
  return null;
}
