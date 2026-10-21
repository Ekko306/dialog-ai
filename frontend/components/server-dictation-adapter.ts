"use client";

import type { DictationAdapter } from "@assistant-ui/react";

/**
 * 服务端转写 DictationAdapter（实现 assistant-ui 官方 DictationAdapter 接口）。
 *
 * 流程：getUserMedia → AudioContext({ sampleRate: 16000 })（浏览器不支持时
 * 回退默认采样率 + 线性重采样）→ AudioWorklet（回退 ScriptProcessorNode）
 * 收集 Float32 帧 → stop() 时合并为 Int16 PCM（16kHz/单声道/小端），
 * POST /api/audio/transcribe（application/octet-stream）转写。
 *
 * 事件语义（与官方 WebSpeechDictationAdapter 对齐）：
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

const TARGET_SAMPLE_RATE = 16000;
// 300ms 的 16kHz PCM = 4800 samples；低于此不上传（契约：400 empty audio）
const MIN_DURATION_SECONDS = 0.3;

// AudioWorklet 内联源码（Blob URL 加载，避免新增独立 .js 文件）
const WORKLET_SOURCE = `
class PcmCollector extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0]?.[0];
    if (channel) this.port.postMessage(channel.slice(0));
    return true;
  }
}
registerProcessor("pcm-collector", PcmCollector);
`;

/** 线性插值重采样到 16kHz（仅采样率不匹配的回退路径使用） */
function linearResample(input: Float32Array, fromRate: number): Float32Array {
  if (fromRate === TARGET_SAMPLE_RATE) return input;
  const ratio = fromRate / TARGET_SAMPLE_RATE;
  const outputLength = Math.floor(input.length / ratio);
  const output = new Float32Array(outputLength);
  for (let i = 0; i < outputLength; i++) {
    const position = i * ratio;
    const index = Math.floor(position);
    const fraction = position - index;
    const current = input[index] ?? 0;
    const next = input[index + 1] ?? current;
    output[i] = current + (next - current) * fraction;
  }
  return output;
}

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
    let cleanupAudio: (() => void) | null = null;
    let abortController: AbortController | null = null;

    const frames: Float32Array[] = [];
    let totalSamples = 0;

    const setStatus = (next: DictationAdapter.Status) => {
      status = next;
    };

    const fail = (error: unknown) => {
      if (ended) return;
      ended = true;
      console.error("[ServerDictationAdapter]", error);
      setStatus({ type: "ended", reason: "error" });
      cleanupAudio?.();
      cleanupAudio = null;
    };

    // 唯一的成功出口：emit 结果（onSpeech + onSpeechEnd）后置 ended/stopped
    const finishStopped = (result: DictationAdapter.Result) => {
      if (ended) return;
      ended = true;
      setStatus({ type: "ended", reason: "stopped" });
      for (const callback of speechCallbacks) callback(result);
      for (const callback of speechEndCallbacks) callback(result);
    };

    const onFrame = (raw: Float32Array) => {
      if (ended || stopRequested) return;
      const resampled = linearResample(raw, actualSampleRate);
      frames.push(resampled);
      totalSamples += resampled.length;
    };
    let actualSampleRate = TARGET_SAMPLE_RATE;

    // 异步启动采集；失败统一走 fail() → ended/error
    void (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { channelCount: { ideal: 1 } },
        });

        let context: AudioContext;
        try {
          context = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
        } catch {
          // 采样率选项不被支持：回退默认采样率，靠线性重采样对齐 16k
          context = new AudioContext();
        }
        actualSampleRate = context.sampleRate;
        await context.resume().catch(() => undefined);

        let node: AudioWorkletNode | ScriptProcessorNode;
        let workletUrl: string | null = null;
        try {
          workletUrl = URL.createObjectURL(
            new Blob([WORKLET_SOURCE], { type: "application/javascript" }),
          );
          await context.audioWorklet.addModule(workletUrl);
          const workletNode = new AudioWorkletNode(context, "pcm-collector");
          workletNode.port.onmessage = (event) => onFrame(event.data as Float32Array);
          node = workletNode;
        } catch {
          // AudioWorklet 不可用：回退 ScriptProcessorNode
          const processor = context.createScriptProcessor(4096, 1, 1);
          processor.onaudioprocess = (event) =>
            onFrame(new Float32Array(event.inputBuffer.getChannelData(0)));
          node = processor;
        } finally {
          if (workletUrl) URL.revokeObjectURL(workletUrl);
        }

        const source = context.createMediaStreamSource(stream);
        // 零增益汇点：让节点持续被拉流，同时避免监听回声
        const mute = context.createGain();
        mute.gain.value = 0;
        source.connect(node);
        node.connect(mute);
        mute.connect(context.destination);

        cleanupAudio = () => {
          try {
            source.disconnect();
          } catch {}
          try {
            node.disconnect();
          } catch {}
          try {
            mute.disconnect();
          } catch {}
          for (const track of stream.getTracks()) track.stop();
          void context.close().catch(() => undefined);
        };

        setStatus({ type: "running" });
        for (const callback of speechStartCallbacks) callback();
      } catch (error) {
        fail(error);
      }
    })();

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

        cleanupAudio?.();
        cleanupAudio = null;

        const durationSeconds = totalSamples / TARGET_SAMPLE_RATE;
        if (durationSeconds < MIN_DURATION_SECONDS) {
          // <300ms：不上传，空结果结束（不发请求）
          finishStopped({ transcript: "", isFinal: true });
          return;
        }

        const pcm = new Int16Array(totalSamples);
        let offset = 0;
        for (const frame of frames) {
          for (let i = 0; i < frame.length; i++) {
            const sample = Math.max(-1, Math.min(1, frame[i] ?? 0));
            pcm[offset + i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
          }
          offset += frame.length;
        }

        abortController = new AbortController();
        try {
          const response = await fetch("/api/audio/transcribe", {
            method: "POST",
            headers: { "Content-Type": "application/octet-stream" },
            body: pcm.buffer,
            signal: abortController.signal,
          });
          if (!response.ok) {
            const detail = await response.text().catch(() => "");
            throw new Error(`transcribe failed: ${response.status} ${detail}`);
          }
          const data = (await response.json()) as { text?: string };
          finishStopped({ transcript: data.text ?? "", isFinal: true });
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
      cleanupAudio?.();
      cleanupAudio = null;
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
        return () => speechEndCallbacks.delete(callback);
      },
    };
  }
}

// 模块级单例：runtime 注入（assistant.tsx）与 InterruptPrompt 语音按钮共用
export const serverDictationAdapter = new ServerDictationAdapter();
