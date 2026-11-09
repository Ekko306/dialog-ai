"use client";

import { ArrowRight, CheckCircle2, Lightbulb, LoaderCircle, Mic, MicOff, RefreshCw, XCircle } from "lucide-react";
import { useEffect, useState } from "react";

import type { ExercisePayload, EvaluationResult } from "@/lib/course-types";
import { getSettings } from "@/lib/profile-settings";
import { useSpeechRecognition } from "@/lib/use-speech-recognition";

const VERDICT_TEXT: Record<EvaluationResult["verdict"], string> = {
  correct: "回答正确",
  acceptable: "基本正确",
  incorrect: "还不太对",
};

const VERDICT_STYLE: Record<EvaluationResult["verdict"], string> = {
  correct: "text-emerald-700 bg-emerald-50 ring-emerald-200",
  acceptable: "text-amber-800 bg-amber-50 ring-amber-200",
  incorrect: "text-red-700 bg-red-50 ring-red-200",
};

const ACCENT_LANG: Record<string, string> = {
  american: "en-US",
  british: "en-GB",
};

interface StageExerciseProps {
  payload: ExercisePayload;
  onSubmit: (input: string) => void;
  submitting: boolean;
}

/** 环节 3 · 练习题（T022）：作答 → 评价/重试 → 收尾确认后推进 */
export function StageExercise({ payload, onSubmit, submitting }: StageExerciseProps) {
  const [value, setValue] = useState("");
  const result = payload.result;
  const confirming = payload.needs_confirm === true;
  const remaining = Math.max(payload.max_attempts - payload.attempts, 0);

  const accent = getSettings().accent;
  const speech = useSpeechRecognition({ lang: ACCENT_LANG[accent] ?? "en-US" });

  useEffect(() => {
    if (speech.finalTranscript) {
      setValue(speech.finalTranscript);
    }
  }, [speech.finalTranscript]);

  const canSubmit = value.trim().length > 0 && !submitting && !speech.listening;

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
      <section className="bg-background rounded-3xl p-5 shadow-sm ring-1 ring-black/5">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground text-[11px] font-medium tracking-wide">
            练习 {payload.exercise_index}/{payload.exercise_total}
          </span>
          {!confirming && (
            <span className="text-muted-foreground text-[11px]">
              已作答 {payload.attempts} 次
            </span>
          )}
        </div>
        <p className="mt-3 text-base leading-relaxed font-medium">{payload.question}</p>
        {!confirming && (
          <button
            type="button"
            disabled={submitting}
            onClick={() => onSubmit("__hint__")}
            className="text-muted-foreground hover:text-foreground mt-3 flex items-center gap-1 text-[11px] transition disabled:opacity-40"
          >
            <Lightbulb className="size-3.5" />
            卡住了？让 AI 给点提示
          </button>
        )}
      </section>

      {payload.hint && (
        <section className="rounded-2xl bg-amber-50 p-4 ring-1 ring-amber-200">
          <div className="flex items-center gap-2 text-xs font-semibold text-amber-800">
            <Lightbulb className="size-4" />
            AI 提示
          </div>
          <p className="mt-2 text-xs leading-relaxed text-amber-900">{payload.hint}</p>
        </section>
      )}

      {result && (
        <section className={`rounded-2xl p-4 ring-1 ${VERDICT_STYLE[result.verdict]}`}>
          <div className="flex items-center gap-2 text-sm font-semibold">
            {result.verdict === "incorrect" ? <XCircle className="size-4" /> : <CheckCircle2 className="size-4" />}
            {VERDICT_TEXT[result.verdict]}
          </div>
          {result.feedback && <p className="mt-2 text-xs leading-relaxed">{result.feedback}</p>}
          {result.suggested && (
            <p className="mt-2 rounded-xl bg-white/60 px-3 py-2 text-xs italic">
              更自然的说法：{result.suggested}
            </p>
          )}
        </section>
      )}

      {confirming ? (
        <>
          {payload.reference_answer && (
            <section className="bg-background rounded-2xl p-4 text-xs shadow-sm ring-1 ring-black/5">
              <span className="text-muted-foreground">参考答案：</span>
              <span className="font-medium">{payload.reference_answer}</span>
            </section>
          )}
          <button
            type="button"
            disabled={submitting}
            onClick={() => onSubmit("continue")}
            className="bg-primary text-primary-foreground flex h-12 w-full items-center justify-center gap-1 rounded-2xl text-sm font-medium transition hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
            {payload.exercise_index < payload.exercise_total ? "下一题" : "进入对话练习"}
          </button>
        </>
      ) : (
        <>
          {!result && (
            <p className="text-muted-foreground px-1 text-[11px]">
              用本课学到的表达作答，答错还有 {remaining} 次机会
            </p>
          )}

          {speech.listening && (
            <p className="text-muted-foreground text-center text-xs">
              正在聆听…请说出你的答案
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
              placeholder={speech.supported ? "语音输入或打字作答" : "输入你的答案"}
              autoComplete="off"
              className="bg-background focus:ring-ring h-12 flex-1 rounded-2xl px-4 text-sm shadow-sm ring-1 ring-black/5 outline-none focus:ring-2"
            />
            <button
              type="submit"
              disabled={!canSubmit}
              className="bg-primary text-primary-foreground flex h-12 items-center gap-1 rounded-2xl px-5 text-sm font-medium transition hover:opacity-90 disabled:opacity-40"
            >
              {submitting ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : result ? (
                <RefreshCw className="size-4" />
              ) : (
                <ArrowRight className="size-4" />
              )}
              提交
            </button>
          </form>
        </>
      )}
    </div>
  );
}
