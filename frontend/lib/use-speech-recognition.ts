"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 浏览器语音识别 hook（Web Speech API）：
 * - 封装 SpeechRecognition / webkitSpeechRecognition
 * - 供「跟读」环节使用：用户点击麦克风朗读，识别出英文文本后提交给后端比对
 * - 不支持时 `supported` 为 false，调用方应回退到文本输入
 */

// TypeScript 全局无 SpeechRecognition 类型，按标准接口最小声明
type SpeechRecognitionAlternative = { transcript: string; confidence: number };
type SpeechRecognitionResult = {
  readonly length: number;
  readonly isFinal: boolean;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
};
type SpeechRecognitionResultList = {
  readonly length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
};
type SpeechRecognitionEvent = {
  resultIndex: number;
  results: SpeechRecognitionResultList;
};
type SpeechRecognitionErrorEvent = { error: string; message?: string };

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface UseSpeechRecognitionOptions {
  /** 识别语言，如 en-US / en-GB */
  lang?: string;
  /** 是否返回中间结果（实时显示说话内容），默认 true */
  interimResults?: boolean;
}

export interface UseSpeechRecognitionReturn {
  /** 浏览器是否支持语音识别 */
  supported: boolean;
  /** 是否正在录音 */
  listening: boolean;
  /** 实时识别出的中间文本（含未确认部分） */
  interimTranscript: string;
  /** 最近一次确认的最终文本 */
  finalTranscript: string;
  /** 最近一次错误信息（如用户拒绝授权） */
  error: string | null;
  /** 开始录音 */
  start: () => void;
  /** 停止录音并触发最终结果 */
  stop: () => void;
}

export function useSpeechRecognition(
  options: UseSpeechRecognitionOptions = {},
): UseSpeechRecognitionReturn {
  const { lang = "en-US", interimResults = true } = options;

  const ctor = getRecognitionCtor();
  const supported = ctor !== null;

  const [listening, setListening] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState("");
  const [finalTranscript, setFinalTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  // 标记是否由用户主动停止（避免 end 回调里误判为异常）
  const manuallyStoppedRef = useRef(false);

  // 初始化 recognition 实例
  useEffect(() => {
    if (!supported) return;
    const recognition = new (ctor as SpeechRecognitionCtor)();
    recognition.lang = lang;
    recognition.continuous = false;
    recognition.interimResults = interimResults;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setListening(true);
      setError(null);
      setInterimTranscript("");
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = "";
      let finalText = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const transcript = result[0].transcript;
        if (result.isFinal) {
          finalText += transcript;
        } else {
          interim += transcript;
        }
      }
      if (interim) setInterimTranscript(interim);
      if (finalText) {
        setFinalTranscript(finalText);
        setInterimTranscript("");
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      // no-speech / aborted 是正常结束，不展示错误
      if (event.error === "no-speech" || event.error === "aborted") return;
      setError(mapError(event.error));
    };

    recognition.onend = () => {
      setListening(false);
    };

    recognitionRef.current = recognition;

    return () => {
      try {
        recognition.abort();
      } catch {
        // 忽略卸载时的异常
      }
      recognitionRef.current = null;
    };
  }, [supported, ctor, lang, interimResults]);

  const start = useCallback(() => {
    if (!recognitionRef.current) return;
    manuallyStoppedRef.current = false;
    setFinalTranscript("");
    setInterimTranscript("");
    setError(null);
    try {
      recognitionRef.current.start();
    } catch {
      // 重复 start 会抛 InvalidStateError，忽略
    }
  }, []);

  const stop = useCallback(() => {
    if (!recognitionRef.current) return;
    manuallyStoppedRef.current = true;
    try {
      recognitionRef.current.stop();
    } catch {
      // 忽略
    }
    setListening(false);
  }, []);

  return {
    supported,
    listening,
    interimTranscript,
    finalTranscript,
    error,
    start,
    stop,
  };
}

function mapError(code: string): string {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "麦克风权限被拒绝，请在浏览器设置中允许使用麦克风";
    case "network":
      return "语音识别网络异常，请检查网络连接";
    case "audio-capture":
      return "未检测到麦克风设备";
    default:
      return `语音识别出错：${code}`;
  }
}
