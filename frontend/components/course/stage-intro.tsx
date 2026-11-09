"use client";

import { ArrowRight, LoaderCircle, Mic, MicOff, Volume2 } from "lucide-react";
import { useEffect, useState } from "react";

import { ttsSourceKey, usePopupAudio } from "@/components/pronunciation-popup/use-popup-audio";
import type { IntroPayload } from "@/lib/course-types";
import { getSettings } from "@/lib/profile-settings";
import { useSpeechRecognition } from "@/lib/use-speech-recognition";

interface StageIntroProps {
  payload: IntroPayload;
  onSubmit: (input: string) => void;
  submitting: boolean;
}

const ACCENT_LANG: Record<string, string> = {
  american: "en-US",
  british: "en-GB",
};

/** 环节 1 · 场景跟读（T020）：场景导入 + 核心句 TTS + 语音跟读识别与重试反馈 */
export function StageIntro({ payload, onSubmit, submitting }: StageIntroProps) {
  const [value, setValue] = useState("");
  const audio = usePopupAudio();

  const accent = getSettings().accent;
  const speakText = payload.tts_text || payload.target_sentence;
  const key = ttsSourceKey(accent, speakText);
  const loading = audio.activeKey === key && audio.status === "loading";
  const playing = audio.activeKey === key && audio.status === "playing";
  const remaining = Math.max(payload.max_attempts - payload.attempts, 0);

  // 语音识别（跟读）：口音 → 识别语言
  const speech = useSpeechRecognition({ lang: ACCENT_LANG[accent] ?? "en-US" });

  // 识别出最终文本后自动填入输入框（用户可再编辑），并准备提交
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

  // 兜底文本输入可见：不支持语音识别，或用户主动想打字修正
  const showTextInput = !speech.supported;

  return (
    <div className="space-y-4">
      <section className="bg-background rounded-3xl p-5 shadow-sm ring-1 ring-black/5">
        <span className="text-muted-foreground text-[11px] font-medium tracking-wide">场景</span>
        <p className="mt-2 text-sm leading-relaxed">{payload.scene}</p>
      </section>

      <section className="rounded-3xl bg-(--bubble-ai) p-5">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] font-medium tracking-wide">跟读这句话</span>
          <button
            type="button"
            onClick={() =>
              playing ? audio.stop() : audio.play({ kind: "tts", text: speakText, accent }, { loop: false })
            }
            aria-label={playing ? "停止播放" : "播放示范读音"}
            className="text-foreground/70 hover:text-foreground flex items-center gap-1 rounded-full px-2 py-1 text-[11px] transition"
          >
            {loading ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Volume2 className="size-4" />
            )}
            {playing ? "停止" : "播放示范"}
          </button>
        </div>
        <p className="mt-3 text-xl leading-snug font-semibold">{payload.target_sentence}</p>
      </section>

      {payload.attempts > 0 && (
        <section className="rounded-2xl bg-amber-50 p-4 text-amber-900 ring-1 ring-amber-200">
          <p className="text-sm font-medium">{payload.feedback ?? "还不够准确，再试一次～"}</p>
          <p className="mt-1 text-xs text-amber-800">{payload.hint}</p>
          <p className="mt-2 text-[11px] text-amber-700">
            还剩 {remaining} 次机会，逐词对照原句再读一遍
          </p>
        </section>
      )}

      {/* 语音跟读区 */}
      <section className="rounded-3xl bg-background p-5 shadow-sm ring-1 ring-black/5">
        <div className="flex flex-col items-center gap-3">
          <button
            type="button"
            onClick={toggleRecord}
            disabled={!speech.supported || submitting}
            aria-label={speech.listening ? "停止录音" : "开始跟读"}
            className={`flex size-16 items-center justify-center rounded-full text-white shadow-md transition active:scale-95 disabled:opacity-40 ${
              speech.listening
                ? "bg-red-500 animate-pulse"
                : "bg-primary hover:opacity-90"
            }`}
          >
            {speech.listening ? <MicOff className="size-7" /> : <Mic className="size-7" />}
          </button>
          <p className="text-muted-foreground text-xs">
            {speech.supported
              ? speech.listening
                ? "正在聆听…请大声读出上面的句子"
                : "点击麦克风，跟着示范读一遍"
              : "当前浏览器不支持语音识别，请使用下方输入框"}
          </p>

          {/* 实时识别文本展示 */}
          {(speech.interimTranscript || value) && (
            <div className="w-full rounded-2xl bg-muted/60 p-3 text-sm">
              {speech.interimTranscript && !speech.finalTranscript && (
                <span className="text-muted-foreground italic">{speech.interimTranscript}</span>
              )}
              {value && <span className="text-foreground">{value}</span>}
            </div>
          )}

          {speech.error && (
            <p className="text-red-500 text-xs">{speech.error}</p>
          )}
        </div>
      </section>

      {/* 兜底：不支持语音识别时显示文本输入；支持时也允许用户编辑后提交 */}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        className="flex items-center gap-2"
      >
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={speech.supported ? "识别结果会显示在这里，可手动修改" : "照着原句输入一遍"}
          autoComplete="off"
          className="bg-background focus:ring-ring h-12 flex-1 rounded-2xl px-4 text-sm shadow-sm ring-1 ring-black/5 outline-none focus:ring-2"
        />
        <button
          type="submit"
          disabled={!canSubmit}
          className="bg-primary text-primary-foreground flex h-12 items-center gap-1 rounded-2xl px-5 text-sm font-medium transition hover:opacity-90 disabled:opacity-40"
        >
          {submitting ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
          提交
        </button>
      </form>

      {showTextInput && (
        <p className="text-muted-foreground text-center text-[11px]">
          提示：使用 Chrome / Edge 浏览器可获得语音跟读体验
        </p>
      )}
    </div>
  );
}
