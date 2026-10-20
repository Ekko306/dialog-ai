"use client";

import {
  useLangChainInterruptState,
  useLangChainRespond,
} from "@assistant-ui/react-langchain";
import { useState } from "react";

/**
 * talk_agent 图的 HITL 输入框，常驻吸附在底部（挂载于 ViewportFooter）。
 * 图在 HITL_node 调用 interrupt() 暂停时输入框可用；发送 resume 后输入框
 * 不消失，仅发送按钮置灰（disabled），直到图下一次 interrupt 暂停再恢复可用。
 * 用户输入经 useLangChainRespond（input.respond 协议，按 interrupt_id 恢复）
 * 回传后端，interrupt() 收到的 resume 值即该字符串。
 * 注意：不要用 submit(null, {command:{resume}})——该路径经 REST /commands
 * 分发，在本 SDK/服务端组合下不会真正恢复图（线程会停留在 interrupt）。
 */
export function InterruptPrompt() {
  const interrupt = useLangChainInterruptState();
  const respond = useLangChainRespond();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 仅在图暂停（有 interrupt）且不在发送中时允许发送
  const canSend = !!interrupt && !sending;

  const prompt = interrupt
    ? typeof interrupt.value === "object" && interrupt.value !== null
      ? String((interrupt.value as { prompt?: string }).prompt ?? "等待输入")
      : String(interrupt.value ?? "等待输入")
    : "等待教练的下一条指示…";

  const resume = async (value: string) => {
    if (!value.trim() || !canSend) return;
    setSending(true);
    setError(null);
    try {
      // interrupt() 的 resume 值 = 裸字符串
      await respond(value.trim());
      setText("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="border-ring/40 bg-muted/30 mx-auto w-full max-w-(--thread-max-width) rounded-xl border p-3">
      <p className="text-muted-foreground mb-2 text-sm">{prompt}</p>
      <div className="flex gap-2">
        <input
          className="border-border focus:border-ring focus:ring-ring/30 flex-1 rounded-md border bg-transparent px-3 py-1.5 text-sm outline-none focus:ring-1 disabled:opacity-50"
          value={text}
          disabled={sending}
          onChange={(e) => setText(e.target.value)}
          placeholder={
            interrupt ? "输入英文，让教练检查语法…" : "教练思考中…"
          }
          onKeyDown={(e) => {
            if (e.key === "Enter") void resume(text);
          }}
        />
        <button
          type="button"
          className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-3 py-1.5 text-sm transition-colors disabled:opacity-50"
          disabled={!canSend || !text.trim()}
          onClick={() => void resume(text)}
        >
          {sending ? "发送中…" : "回复"}
        </button>
      </div>
      {error && (
        <p className="text-destructive mt-2 text-xs">恢复失败：{error}</p>
      )}
    </div>
  );
}
