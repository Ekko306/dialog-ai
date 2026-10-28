"use client";

import type { DictationAdapter } from "@assistant-ui/react";
import { useLangChainInterruptState, useLangChainRespond } from "@assistant-ui/react-langchain";
import { LoaderCircleIcon, MicIcon, SquareIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { serverDictationAdapter } from "@/components/server-dictation-adapter";

type DictationPhase = "idle" | "recording" | "transcribing";

/**
 * talk_agent 图的 HITL 输入框，常驻吸附在底部（挂载于 ViewportFooter）。
 * 图在 HITL_node 调用 interrupt() 暂停时输入框可用；发送 resume 后输入框
 * 不消失，仅发送按钮置灰（disabled），直到图下一次 interrupt 暂停再恢复可用。
 * 用户输入经 useLangChainRespond（input.respond 协议，按 interrupt_id 恢复）
 * 回传后端，interrupt() 收到的 resume 值即该字符串。
 * 注意：不要用 submit(null, {command:{resume}})——该路径经 REST /commands
 * 分发，在本 SDK/服务端组合下不会真正恢复图（线程会停留在 interrupt）。
 *
 * 语音输入（US3，FR-009）：本组件是页面唯一输入面（respond 协议），
 * 故麦克风按钮直接消费 ServerDictationAdapter（官方 DictationAdapter 接口，
 * 经 assistant.tsx 注入 runtime 的同一单例）：单击开始录音，再次单击停止并
 * 转写；转写结果与已键入文本合并后自动发送（不进确认环节）；图未暂停时
 * 转写文本仅填入输入框，可编辑后手动发送；失败/空文本 toast 轻提示 2s。
 */
export function InterruptPrompt() {
  const interrupt = useLangChainInterruptState();
  const respond = useLangChainRespond();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<DictationPhase>("idle");
  const [toast, setToast] = useState<string | null>(null);

  const sessionRef = useRef<DictationAdapter.Session | null>(null);
  const resultRef = useRef<DictationAdapter.Result | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  // 仅在图暂停（有 interrupt）且不在发送中时允许发送
  const canSend = !!interrupt && !sending;

  // 重试要用最新一轮渲染的 respond（其内部捕获当前 interrupt id）：
  // SDK 的 interrupt 对象不会被成功 run 清除（滞留），重放旧 id 会被服务端拒绝
  const respondRef = useRef(respond);
  respondRef.current = respond;

  const showToast = (message: string) => {
    setToast(message);
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 2000);
  };

  // 录音中的异常兜底：适配器任何失败会置 status → ended/error（无结果事件）
  useEffect(() => {
    if (phase !== "recording") return;
    const session = sessionRef.current;
    if (!session) return;
    const timer = window.setInterval(() => {
      const status = session.status;
      if (status.type !== "ended") return;
      window.clearInterval(timer);
      if (status.reason === "error") {
        sessionRef.current = null;
        setPhase("idle");
        showToast("录音启动失败，请检查麦克风权限");
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, [phase]);

  // 卸载清理：取消进行中的录音与 toast 定时器
  useEffect(
    () => () => {
      sessionRef.current?.cancel();
      if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    },
    [],
  );

  const prompt = interrupt
    ? typeof interrupt.value === "object" && interrupt.value !== null
      ? String((interrupt.value as { prompt?: string }).prompt ?? "等待输入")
      : String(interrupt.value ?? "等待输入")
    : "等待教练的下一条指示…";

  const resume = async (value: string) => {
    if (!value.trim() || !canSend) return;
    setSending(true);
    setError(null);
    // 过期中断判定：服务端拒绝重放（旧 interrupt_id 已被消费/不存在）
    const stale = /already-consumed|Unknown|No pending/i;
    try {
      // interrupt() 的 resume 值 = 裸字符串
      await respond(value.trim());
      setText("");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!stale.test(msg)) {
        setError(msg);
      } else {
        // 过期中断自愈：上一轮 interrupt 对象在 SDK 中滞留，回复结束后新状态
        // 需数百 ms 才同步到客户端——等一拍用最新渲染的 respond 重试一次
        setError("中断已过期，正在自动恢复…");
        await new Promise((r) => setTimeout(r, 1000));
        try {
          await respondRef.current(value.trim());
          setText("");
          setError(null);
        } catch (e2) {
          const msg2 = e2 instanceof Error ? e2.message : String(e2);
          setError(stale.test(msg2) ? "恢复失败：会话状态过期，请刷新页面（F5）后重试" : msg2);
        }
      }
    } finally {
      setSending(false);
    }
  };

  const startDictation = () => {
    // getUserMedia 仅在安全上下文（https:// 或 http://localhost）可用；
    // http://<局域网IP> 下提前提示，避免进入录音态后报晦涩的 TypeError
    if (!window.isSecureContext || !navigator.mediaDevices) {
      showToast("语音输入需 https 或 localhost 访问（可运行 npm run dev:https）");
      return;
    }
    const session = serverDictationAdapter.listen();
    sessionRef.current = session;
    resultRef.current = null;
    session.onSpeechEnd((result) => {
      resultRef.current = result;
    });
    setPhase("recording");
  };

  const stopDictation = async () => {
    const session = sessionRef.current;
    if (!session || phase !== "recording") return;
    setPhase("transcribing");
    try {
      // stop() 在 status → ended 后 resolve；失败已在适配器内置 ended/error
      await session.stop();
    } catch {
      // 忽略：以 status / 结果事件为准
    }
    const result = resultRef.current;
    const failed =
      !result || (session.status.type === "ended" && session.status.reason === "error");
    sessionRef.current = null;
    setPhase("idle");

    if (failed) {
      showToast("转写失败，请重试");
      return;
    }
    const transcript = (result?.transcript ?? "").trim();
    if (!transcript) {
      showToast("未识别到语音，请再试一次");
      return;
    }
    // 自动发送：转写文本与已键入文本合并（对齐 composer dictation 追加语义）
    const combined = [text.trim(), transcript].filter(Boolean).join(" ");
    if (canSend) {
      await resume(combined);
    } else {
      // 图未暂停：先填入输入框，可继续编辑后手动发送
      setText(combined);
    }
  };

  return (
    <div className="bg-background border-ring/30 mx-auto w-full max-w-(--thread-max-width) rounded-2xl border p-3 shadow-sm">
      <p className="text-muted-foreground mb-2 text-sm">{prompt}</p>
      <div className="relative flex gap-2">
        {toast && (
          <div
            className="bg-foreground text-background absolute bottom-full left-1/2 mb-2 -translate-x-1/2 rounded-full px-3 py-1 text-xs whitespace-nowrap shadow"
            role="status"
          >
            {toast}
          </div>
        )}
        <button
          type="button"
          aria-label={
            phase === "idle" ? "开始语音输入" : phase === "recording" ? "停止录音并转写" : "转写中"
          }
          className="border-border hover:border-ring hover:text-foreground text-muted-foreground hover:bg-muted/50 rounded-md border px-2.5 transition-colors disabled:opacity-50"
          disabled={phase === "transcribing" || sending}
          onClick={() => (phase === "idle" ? startDictation() : void stopDictation())}
        >
          {phase === "recording" ? (
            <SquareIcon className="text-destructive size-4 animate-pulse" />
          ) : phase === "transcribing" ? (
            <LoaderCircleIcon className="size-4 animate-spin" />
          ) : (
            <MicIcon className="size-4" />
          )}
        </button>
        <input
          className="border-border focus:border-ring focus:ring-ring/30 flex-1 rounded-md border bg-transparent px-3 py-1.5 text-sm outline-none focus:ring-1 disabled:opacity-50"
          value={text}
          disabled={sending}
          onChange={(e) => setText(e.target.value)}
          placeholder={interrupt ? "输入英文，让教练检查语法…" : "教练思考中…"}
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
      {error && <p className="text-destructive mt-2 text-xs">恢复失败：{error}</p>}
    </div>
  );
}
