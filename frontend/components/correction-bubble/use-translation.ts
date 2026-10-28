"use client";

import { useCallback, useRef, useState } from "react";
import { getTranslation } from "@/lib/translation-client";

export type TranslationStatus = "idle" | "loading" | "success" | "failed";

/**
 * 译文加载状态机（004 data-model TranslationResult，FR-002/FR-003/FR-005）：
 * idle ──(展开且缓存未命中)──→ loading ──(成功)──→ success（写缓存）
 *                                 └──(异常/空译文)──→ failed（可重试）
 * 缓存命中由 getTranslation 内部处理（US3 零请求）；本 hook 只管状态流转与防重。
 * 空原句前置拦截（Edge Case 2）：不发请求状态留在 idle，展示分支由组件层渲染不可用提示。
 */
export function useTranslation(messageId: string, rawText: string) {
  const [status, setStatus] = useState<TranslationStatus>("idle");
  const [text, setText] = useState<string | null>(null);
  const loadingRef = useRef(false);

  const request = useCallback(async () => {
    // 防重守卫（Edge Case 1）：loading 期间重复触发不重发请求
    if (loadingRef.current) return;
    if (!rawText.trim()) return;
    loadingRef.current = true;
    setStatus("loading");
    try {
      const result = await getTranslation(messageId, rawText);
      if (result) {
        setText(result);
        setStatus("success");
      } else {
        // 空译文 = 后端失败/空输入兜底，不缓存可重试（US2/FR-003）
        setText(null);
        setStatus("failed");
      }
    } catch {
      // 网络/服务异常同走失败态（FR-003 行内提示，无弹窗）
      setText(null);
      setStatus("failed");
    } finally {
      loadingRef.current = false;
    }
  }, [messageId, rawText]);

  /** 展开翻译区时调用：缓存命中即时 success，未命中发起请求 */
  const open = useCallback(() => {
    void request();
  }, [request]);

  /** 失败重试（US2）：重新走 loading → 请求 */
  const retry = useCallback(() => {
    void request();
  }, [request]);

  return { status, text, open, retry };
}
