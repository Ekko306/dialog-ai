import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * profile-settings 的 theme 字段单测（我的-设置 → 外观模式）：
 * store 是模块级单例（懒加载缓存），每个用例 vi.resetModules + 动态 import
 * 隔离缓存；localStorage 由 jsdom 提供。
 */

const dynamicImport = async () => {
  vi.resetModules();
  return await import("@/lib/profile-settings");
};

beforeEach(() => {
  localStorage.clear();
});

describe("theme 字段存取（外观模式）", () => {
  it("默认值为 system（跟随系统）", async () => {
    const { getSettings, DEFAULT_SETTINGS } = await dynamicImport();
    expect(DEFAULT_SETTINGS.theme).toBe("system");
    expect(getSettings().theme).toBe("system");
  });

  it("updateSettings 写入并持久化，重载后读回", async () => {
    const m1 = await dynamicImport();
    m1.updateSettings({ theme: "dark" });
    expect(m1.getSettings().theme).toBe("dark");

    // 新模块实例（模拟页面刷新）从 localStorage 读回
    const m2 = await dynamicImport();
    expect(m2.getSettings().theme).toBe("dark");
  });

  it("非法 theme 值兜底为 system", async () => {
    localStorage.setItem(
      "dialog-ai:profile:settings",
      JSON.stringify({ theme: "midnight", accent: "british" }),
    );
    const { getSettings } = await dynamicImport();
    expect(getSettings().theme).toBe("system");
    expect(getSettings().accent).toBe("british"); // 其他字段不受影响
  });

  it("旧版本存量数据无 theme 字段时补默认值，不丢已有字段", async () => {
    localStorage.setItem(
      "dialog-ai:profile:settings",
      JSON.stringify({ accent: "british", loopDefault: true, ttsEnabled: false }),
    );
    const { getSettings } = await dynamicImport();
    expect(getSettings()).toMatchObject({
      accent: "british",
      loopDefault: true,
      ttsEnabled: false,
      theme: "system",
    });
  });

  it("theme 变更通知订阅者（useSyncExternalStore 依赖）", async () => {
    const { subscribeSettings, updateSettings } = await dynamicImport();
    const notified = vi.fn();
    const unsubscribe = subscribeSettings(notified);
    updateSettings({ theme: "light" });
    expect(notified).toHaveBeenCalled();
    unsubscribe();
  });

  it("localStorage 存了非法 JSON → 全量兜底默认值，不抛异常", async () => {
    localStorage.setItem("dialog-ai:profile:settings", "{not-valid-json");
    const { getSettings } = await dynamicImport();
    expect(getSettings()).toEqual({
      accent: "american",
      loopDefault: false,
      ttsEnabled: true,
      theme: "system",
    });
  });

  it("localStorage 存了非对象值（数字/字符串）→ 全量兜底默认值", async () => {
    localStorage.setItem("dialog-ai:profile:settings", "42");
    const { getSettings } = await dynamicImport();
    expect(getSettings().theme).toBe("system");
    expect(getSettings().accent).toBe("american");
  });
});
