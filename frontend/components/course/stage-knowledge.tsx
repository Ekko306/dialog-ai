"use client";

import {
  ArrowRight,
  CheckCircle2,
  Lightbulb,
  LoaderCircle,
  Mic,
  MicOff,
  Sparkles,
  XCircle,
} from "lucide-react";
import { useEffect, useState } from "react";

import type { EvaluationResult, KnowledgePayload } from "@/lib/course-types";
import { getSettings } from "@/lib/profile-settings";
import { useSpeechRecognition } from "@/lib/use-speech-recognition";

const ACCENT_LANG: Record<string, string> = {
  american: "en-US",
  british: "en-GB",
};

const VERDICT_STYLE: Record<EvaluationResult["verdict"], string> = {
  correct: "text-emerald-700 bg-emerald-50 ring-emerald-200",
  acceptable: "text-amber-800 bg-amber-50 ring-amber-200",
  incorrect: "text-red-700 bg-red-50 ring-red-200",
};

interface StageKnowledgeProps {
  payload: KnowledgePayload;
  onSubmit: (input: string) => void;
  submitting: boolean;
}

/**
 * 环节 2 · 知识点（T021）：逐条展示讲解与例句，
 * 讲完后 AI 主动提问检验是否会用；学习者作答后给出点评与引导，再进入练习。
 */
export function StageKnowledge({ payload, onSubmit, submitting }: StageKnowledgeProps) {
  const [value, setValue] = useState("");
  const [showHint, setShowHint] = useState(false);

  const accent = getSettings().accent;
  const speech = useSpeechRecognition({ lang: ACCENT_LANG[accent] ?? "en-US" });

  useEffect(() => {
    if (speech.finalTranscript) setValue(speech.finalTranscript);
  }, [speech.finalTranscript]);

  const confirming = payload.needs_confirm === true && payload.result;
  const hasQuestion = Boolean(payload.question);
  const canSubmit = value.trim().length > 0 && !submitting && !speech.listening;

  const submitAnswer = () => {
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
      <section className="rounded-2xl bg-(--bubble-ai) px-4 py-3 text-xs leading-relaxed">
        {confirming
          ? "这是 AI 导师对你刚才回答的点评，看完就可以开始练习。"
          : hasQuestion
            ? "跟读通过！先看要点，然后回答 AI 导师的提问，检验你是否真的会用。"
            : "跟读通过！先看看这句话的要点，然后做一道小练习。"}
      </section>

      <div className="space-y-3">
        {payload.points.map((point) => (
          <section
            key={point.title}
            className="bg-background rounded-3xl p-5 shadow-sm ring-1 ring-black/5"
          >
            <div className="flex items-center gap-2">
              <Lightbulb className="size-4 text-(--icon-brand-green)" />
              <h3 className="text-sm font-semibold">{point.title}</h3>
            </div>
            <p className="text-muted-foreground mt-2 text-xs leading-relaxed">{point.explanation}</p>
            <p className="mt-3 rounded-xl bg-muted px-3 py-2 text-xs italic">{point.example}</p>
          </section>
        ))}
      </div>

      {/* 作答后：AI 点评与引导 */}
      {confirming && payload.result && (
        <section className={`rounded-2xl p-4 ring-1 ${VERDICT_STYLE[payload.result.verdict]}`}>
          <div className="flex items-center gap-2 text-sm font-semibold">
            {payload.result.verdict === "incorrect" ? (
              <XCircle className="size-4" />
            ) : (
              <CheckCircle2 className="size-4" />
            )}
            AI 导师点评
          </div>
          {payload.result.feedback && (
            <p className="mt-2 text-xs leading-relaxed">{payload.result.feedback}</p>
          )}
          {payload.result.suggested && (
            <p className="mt-2 rounded-xl bg-white/60 px-3 py-2 text-xs italic">
              更自然：{payload.result.suggested}
            </p>
          )}
          {payload.result.hint && (
            <p className="mt-2 text-[11px] leading-relaxed opacity-80">下一步：{payload.result.hint}</p>
          )}
        </section>
      )}

      {confirming ? (
        <button
          type="button"
          disabled={submitting}
          onClick={() => onSubmit("ok")}
          className="bg-primary text-primary-foreground flex h-12 w-full items-center justify-center gap-1 rounded-2xl text-sm font-medium transition hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
          开始练习
        </button>
      ) : (
        <>
          {/* AI 主动提问 */}
          {hasQuestion && (
            <section className="bg-background rounded-3xl p-5 shadow-sm ring-1 ring-black/5">
              <div className="flex items-center gap-2">
                <Sparkles className="size-4 text-(--icon-brand-green)" />
                <span className="text-[11px] font-medium tracking-wide">AI 导师提问</span>
              </div>
              <p className="mt-2 text-sm leading-relaxed font-medium">{payload.question}</p>
              {payload.hint &&
                (showHint ? (
                  <p className="text-muted-foreground mt-3 rounded-xl bg-muted px-3 py-2 text-xs leading-relaxed">
                    {payload.hint}
                  </p>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowHint(true)}
                    className="text-muted-foreground hover:text-foreground mt-3 flex items-center gap-1 text-[11px] transition"
                  >
                    <Lightbulb className="size-3.5" />
                    看提示
                  </button>
                ))}
            </section>
          )}

          {hasQuestion && (
            <>
              {speech.listening && (
                <p className="text-muted-foreground text-center text-xs">
                  正在聆听…请用英文回答
                  {speech.interimTranscript && (
                    <span className="text-foreground/60 italic">（{speech.interimTranscript}）</span>
                  )}
                </p>
              )}
              {speech.error && <p className="text-red-500 text-center text-xs">{speech.error}</p>}

              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  submitAnswer();
                }}
                className="flex items-center gap-2"
              >
                {speech.supported && (
                  <button
                    type="button"
                    onClick={toggleRecord}
                    disabled={submitting}
                    aria-label={speech.listening ? "停止录音" : "语音回答"}
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
                  placeholder={speech.supported ? "语音或打字回答导师的提问" : "用英文回答导师的提问"}
                  autoComplete="off"
                  className="bg-background focus:ring-ring h-12 flex-1 rounded-2xl px-4 text-sm shadow-sm ring-1 ring-black/5 outline-none focus:ring-2"
                />
                <button
                  type="submit"
                  disabled={!canSubmit}
                  className="bg-primary text-primary-foreground flex h-12 items-center gap-1 rounded-2xl px-5 text-sm font-medium transition hover:opacity-90 disabled:opacity-40"
                >
                  {submitting ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
                  回答
                </button>
              </form>
            </>
          )}

          <button
            type="button"
            disabled={submitting}
            onClick={() => onSubmit("ok")}
            className="text-muted-foreground hover:text-foreground w-full text-center text-xs transition"
          >
            直接开始练习
          </button>
        </>
      )}
    </div>
  );
}
