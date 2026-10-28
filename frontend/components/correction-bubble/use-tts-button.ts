"use client";

import { useCallback, useState } from "react";
import { useAudioPlayback } from "@/lib/audio-manager";
import { getTtsAudioUrl, type CorrectionInput } from "@/lib/tts-client";

/**
 * 双 AI 发音按钮共享的合成+播放链路（US3，FR-004/FR-005/FR-012）：
 * loading 期间重复点击不重复发起；合成/请求失败经 onFailed 回调由调用方轻提示
 * （FR-012「明确提示 + 可重试」，文案与跟读面板一致，T021）；
 * 互斥与播放状态全部委托全局 audio-manager（sourceId 即按钮锚点）。
 */
export function useTtsButton(
  messageId: string,
  kind: "raw" | "correct",
  rawText: string,
  corrections: CorrectionInput[],
  onFailed?: (message: string) => void,
) {
  const [loading, setLoading] = useState(false);
  const sourceId = `${messageId}:${kind}`;
  const play = useAudioPlayback((s) => s.play);

  const status = useAudioPlayback((s) => (s.sourceId === sourceId ? s.status : "idle"));

  const handlePlay = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    try {
      const url = await getTtsAudioUrl(messageId, kind, rawText, corrections);
      if (!url) {
        onFailed?.("语音合成失败，请稍后重试");
        return;
      }
      await play(sourceId, url);
    } catch {
      // 网络/服务异常同走失败态（FR-012）
      onFailed?.("语音合成失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  }, [loading, messageId, kind, rawText, corrections, play, sourceId, onFailed]);

  return { handlePlay, loading, status };
}
