import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 亮暗模式边界测试（theme-applier + settings-section）：
 * - applyThemeFromSettings 的四象限判定（浅色/深色 × 系统亮/暗）；
 * - system 模式下系统配色实时联动（matchMedia change 事件）；
 * - 固定模式下系统配色变化不误切；
 * - 组件卸载后移除监听（系统变化不再应用）；
 * - 设置变更即时生效（订阅路径）；
 * - settings-section 外观模式三段控件的渲染与写入。
 *
 * jsdom 无 matchMedia，用可编程桩替代：matches 走 getter，listener 集中捕获，
 * window.matchMedia 每次返回同一对象以模拟真实 MediaQueryList 单例语义。
 */

const dynamicImport = async () => {
  vi.resetModules();
  // 三者同代导入：settings-section 内部 import 的 profile-settings 与这里返回的
  // settings 是同一模块实例（缓存一致），否则断言会读到旧缓存
  const [settings, themeApplier, settingsSection] = await Promise.all([
    import("@/lib/profile-settings"),
    import("@/components/theme-applier"),
    import("@/components/my-profile/settings-section"),
  ]);
  return { settings, themeApplier, SettingsSection: settingsSection.SettingsSection };
};

/** 可编程 matchMedia 桩：setMatches 改变系统配色，fireChange 手动派发 change */
const installMatchMediaStub = () => {
  let current = false;
  const listeners = new Set<(event: { matches: boolean }) => void>();
  const mq = {
    get matches() {
      return current;
    },
    addEventListener: (_type: string, listener: (event: { matches: boolean }) => void) => {
      listeners.add(listener);
    },
    removeEventListener: (_type: string, listener: (event: { matches: boolean }) => void) => {
      listeners.delete(listener);
    },
  };
  vi.stubGlobal("matchMedia", () => mq);
  return {
    setMatches: (value: boolean) => {
      current = value;
    },
    fireChange: () => {
      listeners.forEach((listener) => listener({ matches: current }));
    },
    listenerCount: () => listeners.size,
  };
};

let mq: ReturnType<typeof installMatchMediaStub>;

beforeEach(async () => {
  localStorage.clear();
  document.documentElement.classList.remove("dark");
  mq = installMatchMediaStub();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("applyThemeFromSettings 四象限判定", () => {
  it("theme=dark → 加 .dark（即使系统为浅色）", async () => {
    const { settings, themeApplier } = await dynamicImport();
    mq.setMatches(false);
    settings.updateSettings({ theme: "dark" });

    themeApplier.applyThemeFromSettings();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("theme=light → 移除 .dark（即使系统为深色）", async () => {
    const { settings, themeApplier } = await dynamicImport();
    mq.setMatches(true);
    settings.updateSettings({ theme: "light" });

    themeApplier.applyThemeFromSettings();
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("theme=system + 系统深色 → 加 .dark", async () => {
    const { settings, themeApplier } = await dynamicImport();
    mq.setMatches(true);
    settings.updateSettings({ theme: "system" });

    themeApplier.applyThemeFromSettings();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("theme=system + 系统浅色 → 移除 .dark", async () => {
    const { settings, themeApplier } = await dynamicImport();
    mq.setMatches(false);
    settings.updateSettings({ theme: "system" });

    themeApplier.applyThemeFromSettings();
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("幂等：重复应用同一模式不产生残留类", async () => {
    const { settings, themeApplier } = await dynamicImport();
    mq.setMatches(true);
    settings.updateSettings({ theme: "system" });

    themeApplier.applyThemeFromSettings();
    themeApplier.applyThemeFromSettings();
    themeApplier.applyThemeFromSettings();
    expect(document.documentElement.className).toBe("dark");
  });
});

describe("system 模式实时联动（matchMedia change）", () => {
  it("ThemeApplier 挂载后系统配色切换 → 类即时跟随", async () => {
    const { settings, themeApplier } = await dynamicImport();
    settings.updateSettings({ theme: "system" });
    mq.setMatches(false);

    render(<themeApplier.ThemeApplier />);
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    mq.setMatches(true);
    mq.fireChange();
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    mq.setMatches(false);
    mq.fireChange();
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("固定模式（light）下系统配色切换不误切", async () => {
    const { settings, themeApplier } = await dynamicImport();
    settings.updateSettings({ theme: "light" });

    render(<themeApplier.ThemeApplier />);
    mq.setMatches(true);
    mq.fireChange();
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("设置变更即时生效（updateSettings 订阅路径）", async () => {
    const { settings, themeApplier } = await dynamicImport();
    settings.updateSettings({ theme: "light" });

    render(<themeApplier.ThemeApplier />);
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    settings.updateSettings({ theme: "dark" });
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("卸载后移除监听：系统配色变化不再应用主题", async () => {
    const { settings, themeApplier } = await dynamicImport();
    settings.updateSettings({ theme: "system" });
    mq.setMatches(false);

    const { unmount } = render(<themeApplier.ThemeApplier />);
    unmount();
    expect(mq.listenerCount()).toBe(0);

    mq.setMatches(true);
    mq.fireChange();
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});

describe("settings-section 外观模式控件", () => {
  it("渲染浅色/深色/跟随系统三段控件，当前模式带 aria-pressed", async () => {
    const { settings, SettingsSection } = await dynamicImport();
    settings.updateSettings({ theme: "dark" });

    render(<SettingsSection />);
    expect(screen.getByRole("button", { name: "浅色" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "深色" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "跟随系统" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
  });

  it("点击浅色 → store 更新 + localStorage 持久化", async () => {
    const { settings, SettingsSection } = await dynamicImport();
    settings.updateSettings({ theme: "dark" });

    render(<SettingsSection />);
    fireEvent.click(screen.getByRole("button", { name: "浅色" }));

    expect(settings.getSettings().theme).toBe("light");
    expect(JSON.parse(localStorage.getItem("dialog-ai:profile:settings") ?? "{}").theme).toBe(
      "light",
    );
  });

  it("切换 theme 不影响其他设置字段", async () => {
    const { settings, SettingsSection } = await dynamicImport();
    settings.updateSettings({ accent: "british", ttsEnabled: false });

    render(<SettingsSection />);
    fireEvent.click(screen.getByRole("button", { name: "深色" }));

    expect(settings.getSettings()).toMatchObject({
      theme: "dark",
      accent: "british",
      ttsEnabled: false,
    });
  });
});
