"use client";

import { Lightbulb, LoaderCircle, Mic, MicOff, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { RoleplayPayload, RoleplayTurn } from "@/lib/course-types";
import { getSettings } from "@/lib/profile-settings";
import { useSpeechRecognition } from "@/lib/use-speech-recognition";

interface StageRoleplayProps {
  payload: RoleplayPayload;
  transcript: RoleplayTurn[];
  onSubmit: (input: string) => void;
  submitting: boolean;
}

const ACCENT_LANG: Record<string, string> = {
  american: "en-US",
  british: "en-GB",
};

/** 环节 4 · 角色扮演（T023）：AI 开场 + 逐轮对话，每轮给出评价与更自然说法 */
export function StageRoleplay({ payload, transcript, onSubmit, submitting }: StageRoleplayProps) {
  const [value, setValue] = useState("");
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const accent = getSettings().accent;
  const speech = useSpeechRecognition({ lang: ACCENT_LANG[accent] ?? "en-US" });

  // 识别出最终文本后填入输入框（用户可再编辑）
  useEffect(() => {
    if (speech.finalTranscript) {
      setValue(speech.finalTranscript);
    }
  }, [speech.finalTranscript]);

  const turns: RoleplayTurn[] =
    transcript.length > 0
      ? transcript
      : [{ role: "assistant", text: payload.ai_message, evaluation: null }];
  const canSubmit = value.trim().length > 0 && !submitting && !speech.listening;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns.length]);

  const submit = () => {
    if (!canSubmit) return;
    onSubmit(value.trim());
    setValue("");
  };

  const toggleRecord = () => {
    if (speech.listening) {
      speech.stop();
    } else {
      setValue("");
      speech.start();
    }
  };

  return (
    <div className="space-y-4">
      <section className="bg-background rounded-3xl p-4 shadow-sm ring-1 ring-black/5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium tracking-wide">对话对象 · {payload.role}</span>
          <span className="text-muted-foreground text-[11px] tabular-nums">
            第 {Math.min(payload.round, payload.max_rounds)}/{payload.max_rounds} 轮
          </span>
        </div>
        <p className="text-muted-foreground mt-2 text-xs leading-relaxed">{payload.setting}</p>
        <p className="mt-1 text-xs leading-relaxed">
          <span className="text-muted-foreground">目标：</span>
          {payload.goal}
        </p>
      </section>

      <div className="space-y-3">
        {turns.map((turn, index) =>
          turn.role === "assistant" ? (
            <div key={index} className="flex">
              <div className="max-w-[85%] rounded-2xl rounded-bl-md bg-(--bubble-ai) px-4 py-3 text-sm leading-relaxed">
                {turn.text}
              </div>
            </div>
          ) : (
            <div key={index} className="flex flex-col items-end gap-1">
              <div className="bg-primary/10 max-w-[85%] rounded-2xl rounded-br-md px-4 py-3 text-sm leading-relaxed">
                {turn.text}
              </div>
              {turn.evaluation && (
                <div className="text-muted-foreground max-w-[85%] space-y-1 px-1 text-[11px] leading-relaxed">
                  <p>{turn.evaluation.feedback}</p>
                  {turn.evaluation.suggested && (
                    <p className="text-foreground/70 italic">更自然：{turn.evaluation.suggested}</p>
                  )}
                </div>
              )}
            </div>
          ),
        )}
        <div ref={bottomRef} />
      </div>

      {/* AI 回应提示 */}
      {payload.hint && (
        <section className="rounded-2xl bg-amber-50 p-4 ring-1 ring-amber-200">
          <div className="flex items-center gap-2 text-xs font-semibold text-amber-800">
            <Lightbulb className="size-4" />
            AI 提示
          </div>
          <p className="mt-2 text-xs leading-relaxed text-amber-900">{payload.hint}</p>
        </section>
      )}

      {!speech.listening && (
        <button
          type="button"
          disabled={submitting}
          onClick={() => onSubmit("__hint__")}
          className="text-muted-foreground hover:text-foreground flex w-full items-center justify-center gap-1 text-[11px] transition disabled:opacity-40"
        >
          <Lightbulb className="size-3.5" />
          不知道怎么接？让 AI 给点提示
        </button>
      )}

      {/* 实时识别提示 */}
      {speech.listening && (
        <p className="text-muted-foreground text-center text-xs">
          正在聆听…请用英文回应
          {speech.interimTranscript && (
            <span className="text-foreground/60 italic">（{speech.interimTranscript}）</span>
          )}
        </p>
      )}
      {speech.error && <p className="text-red-500 text-center text-xs">{speech.error}</p>}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        className="flex items-center gap-2"
      >
        {speech.supported && (
          <button
            type="button"
            onClick={toggleRecord}
            disabled={submitting}
            aria-label={speech.listening ? "停止录音" : "语音输入"}
            className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-white transition active:scale-95 disabled:opacity-40 ${
              speech.listening ? "bg-red-500 animate-pulse" : "bg-primary hover:opacity-90"
            }`}
          >
            {speech.listening ? <MicOff className="size-5" /> : <Mic className="size-5" />}
          </button>
        )}
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={speech.supported ? "语音输入或打字回应" : "用英文回一句"}
          autoComplete="off"
          className="bg-background focus:ring-ring h-12 flex-1 rounded-2xl px-4 text-sm shadow-sm ring-1 ring-black/5 outline-none focus:ring-2"
        />
        <button
          type="submit"
          disabled={!canSubmit}
          className="bg-primary text-primary-foreground flex h-12 w-12 items-center justify-center rounded-2xl transition hover:opacity-90 disabled:opacity-40"
          aria-label="发送"
        >
          {submitting ? <LoaderCircle className="size-4 animate-spin" /> : <Send className="size-4" />}
        </button>
      </form>

      <button
        type="button"
        disabled={submitting}
        onClick={() => onSubmit("finish")}
        className="text-muted-foreground hover:text-foreground w-full text-center text-xs transition"
      >
        结束对话练习，直接看总结
      </button>
    </div>
  );
}
