import path from "node:path";

import { defineConfig } from "vitest/config";

/**
 * 前端单测配置（vitest + jsdom）：
 * - "@/*" 别名与 tsconfig paths 保持一致（vitest 不读 tsconfig paths）；
 * - 仅收集 *.test.ts(x)，与 next build 的产物互不影响；
 * - 运行方式：frontend 下 `pnpm test`（vitest run）/ `pnpm run test:watch`。
 */
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname) },
  },
  // 组件链会 import 依赖包内的 .css（如 @assistant-ui/react-markdown/styles）；
  // 空 postcss 内联配置避免 vite 去加载 Tailwind v4 的 postcss.config.mjs（格式不兼容）
  css: { postcss: {} },
  test: {
    environment: "jsdom",
    include: ["**/*.test.{ts,tsx}"],
  },
});
