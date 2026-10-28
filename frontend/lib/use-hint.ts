"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 轻提示 hook（analyze F1 决议）：静态占位入口（收藏/发音分析/更多地道/麦克风）
 * 统一的"功能开发中"提示形态——行内文字淡入淡出 1.5s，无弹窗无跳转。
 */
export function useHint(durationMs = 1500): [string | null, (message: string) => void] {
  const [hint, setHint] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showHint = useCallback(
    (message: string) => {
      setHint(message);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setHint(null), durationMs);
    },
    [durationMs],
  );

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  return [hint, showHint];
}
