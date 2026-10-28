"use client";

import type { DictationAdapter } from "@assistant-ui/react";
import { startPcmRecording, type PcmRecorderHandle } from "@/lib/pcm-recorder";
import { recordingStore } from "@/lib/evaluation-client";

/**
 * 服务端转写 DictationAdapter（实现 assistant-ui 官方 DictationAdapter 接口）。
 *
 * 采集段委托 lib/pcm-recorder（007 T003 抽取，与重读录音区共用）；
 * 本文件保留 adapter 语义编排：
 *
 * 流程：startPcmRecording（16kHz Int16 裸 PCM，详见 pcm-recorder.ts）→
 * stop() 时 POST /api/audio/transcribe（application/octet-stream）转写；
 * 成功转写后把 PCM 按「转写文本」写入 recordingStore（007 T005，供发音
 * 面板按需评测，data-model.md）。
 *
 * 事件语义（与官方 WebSpeechDictationAdapter 对齐，零变化）：
 * - 成功（含空文本）：emit 一次 onSpeech + onSpeechEnd（{ transcript, isFinal: true }），
 *   status → ended/stopped；
 * - <300ms：不上传，emit 空文本结果，status → ended/stopped；
 * - 任何失败（权限、采集、网络、服务端）：console.error，status → ended/error，
 *   不 emit 结果事件；
 * - cancel()：status → ended/cancelled，不 emit 结果事件。
 * stop() 在 status 变为 ended 后才 resolve（官方参考实现同款语义）。
 *
 * 契约：frontend/specs/001-main-tab-shell/contracts/audio-transcribe.md
 */

export class ServerDictationAdapter implements DictationAdapter {
  disableInputDuringDictation = false;

  listen(): DictationAdapter.Session {
    const speechStartCallbacks = new Set<() => void>();
    const speechCallbacks = new Set<(result: DictationAdapter.Result) => void>();
    const speechEndCallbacks = new Set<(result: DictationAdapter.Result) => void>();

    let status: DictationAdapter.Status = { type: "starting" };
    let ended = false;
    let stopRequested = false;
    let stopPromise: Promise<void> | null = null;
    let abortController: AbortController | null = null;
    let recorder: PcmRecorderHandle | null = null;

    const setStatus = (next: DictationAdapter.Status) => {
      status = next;
    };

    const fail = (error: unknown) => {
      if (ended) return;
      ended = true;
      console.error("[ServerDictationAdapter]", error);
      setStatus({ type: "ended", reason: "error" });
      recorder?.cancel();
    };

    // 唯一的成功出口：emit 结果（onSpeech + onSpeechEnd）后置 ended/stopped
    const finishStopped = (result: DictationAdapter.Result) => {
      if (ended) return;
      ended = true;
      setStatus({ type: "ended", reason: "stopped" });
      for (const callback of speechCallbacks) callback(result);
      for (const callback of speechEndCallbacks) callback(result);
    };

    recorder = startPcmRecording({
      onReady: () => {
        setStatus({ type: "running" });
        for (const callback of speechStartCallbacks) callback();
      },
      onError: (error) => fail(error),
    });

    const stop = async (): Promise<void> => {
      if (stopRequested) return stopPromise ?? Promise.resolve();
      stopRequested = true;
      stopPromise = (async () => {
        // stop() 可能在采集仍在启动时被调用：等待启动完成或失败
        while (status.type === "starting") {
          if (ended) return;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        if (status.type !== "running") return;

        const result = await recorder.stop();
        if (result === null) {
          // 过短：原语义 = 空文本成功结束（不发请求）；
          // 已 cancel / 启动失败：ended 已置，不再 emit
          if (!ended) finishStopped({ transcript: "", isFinal: true });
          return;
        }

        abortController = new AbortController();
        try {
          const response = await fetch("/api/audio/transcribe", {
            method: "POST",
            headers: { "Content-Type": "application/octet-stream" },
            body: result.pcm,
            signal: abortController.signal,
          });
          if (!response.ok) {
            const detail = await response.text().catch(() => "");
            throw new Error(`transcribe failed: ${response.status} ${detail}`);
          }
          const data = (await response.json()) as { text?: string };
          const transcript = data.text ?? "";
          // 007 T005：成功转写后按转写文本暂存本轮录音 PCM（= 用户发送的 raw_text，
          // 发音面板打开时据此查 PCM 发起按需评测）；空文本不写。
          // 键用 trim 后文本：composer 发送时会 trim，IAT 输出可能带尾随空白，
          // 不 trim 会导致面板按 raw_text 精确查找失配（2026-10-27 实测踩坑）
          const storeKey = transcript.trim();
          if (storeKey) recordingStore.set(storeKey, result.pcm);
          finishStopped({ transcript, isFinal: true });
        } catch (error) {
          if (abortController.signal.aborted) return; // cancel() 已置 ended/cancelled
          fail(error);
        }
      })();
      return stopPromise;
    };

    const cancel = () => {
      if (ended) return;
      ended = true;
      abortController?.abort();
      setStatus({ type: "ended", reason: "cancelled" });
      recorder?.cancel();
    };

    return {
      get status() {
        return status;
      },
      stop,
      cancel,
      onSpeechStart: (callback) => {
        speechStartCallbacks.add(callback);
        return () => speechStartCallbacks.delete(callback);
      },
      onSpeech: (callback) => {
        speechCallbacks.add(callback);
        return () => speechCallbacks.delete(callback);
      },
      onSpeechEnd: (callback) => {
        speechEndCallbacks.add(callback);
        return () => speechCallbacks.delete(callback);
      },
    };
  }
}

// 模块级单例：runtime 注入（assistant.tsx）与 InterruptPrompt 语音按钮共用
export const serverDictationAdapter = new ServerDictationAdapter();
