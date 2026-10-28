"use client";

/**
 * 可复用裸 PCM 采集工具（007 T003，从 components/server-dictation-adapter.ts
 * 抽取采集段；adapter 与重读录音区两消费方共用，research R3）。
 *
 * 采集链（与 001 转写端点、007 评测端点的输入要求一致）：
 * getUserMedia → AudioContext({ sampleRate: 16000 })（浏览器不支持时回退默认
 * 采样率 + 线性重采样）→ AudioWorklet 内联 PcmCollector（回退
 * ScriptProcessorNode）收集 Float32 帧 → stop() 合并为 Int16 PCM
 * （16kHz / 单声道 / 小端）。
 *
 * 语义（server-dictation-adapter 原样保留）：
 * - stop() 在启动完成后合并返回 { pcm, durationSeconds }；
 *   <300ms、启动失败或已取消 → null（消费方自行区分文案）；
 * - 启动/采集失败（权限被拒、设备不可用等）经 onError 通知，不抛给 stop；
 * - cancel() 立即终止并释放设备，结果丢弃。
 */

const TARGET_SAMPLE_RATE = 16000;
// 300ms 的 16kHz PCM = 4800 samples；低于此 stop() 返回 null（契约：400 empty audio）
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

export interface PcmRecorderResult {
  /** 合并后的 Int16 PCM（16kHz/单声道/小端），可直接作 octet-stream body */
  pcm: ArrayBuffer;
  durationSeconds: number;
}

export interface PcmRecorderHandle {
  /** 结束采集并合并 PCM；<300ms / 已取消 / 启动失败 → null */
  stop(): Promise<PcmRecorderResult | null>;
  /** 立即终止采集（释放麦克风，结果丢弃） */
  cancel(): void;
}

export interface PcmRecorderCallbacks {
  /** 采集就绪（麦克风已开、节点已连） */
  onReady?: () => void;
  /** 启动/采集失败（权限被拒、navigator.mediaDevices 不可用等）；触发后 stop() 返回 null */
  onError?: (error: unknown) => void;
}

export function startPcmRecording(callbacks: PcmRecorderCallbacks = {}): PcmRecorderHandle {
  const { onReady, onError } = callbacks;

  const frames: Float32Array[] = [];
  let totalSamples = 0;
  let actualSampleRate = TARGET_SAMPLE_RATE;
  let ended = false;
  let stopRequested = false;
  let stopPromise: Promise<PcmRecorderResult | null> | null = null;
  let cleanupAudio: (() => void) | null = null;

  const cleanup = () => {
    cleanupAudio?.();
    cleanupAudio = null;
  };

  const onFrame = (raw: Float32Array) => {
    if (ended || stopRequested) return;
    const resampled = linearResample(raw, actualSampleRate);
    frames.push(resampled);
    totalSamples += resampled.length;
  };

  // 异步启动采集；失败统一走 onError（不抛给 stop，语义对齐 adapter 原 fail()）
  const startupPromise = (async () => {
    try {
      // getUserMedia 仅在安全上下文（https:// 或 http://localhost）可用，
      // http://<局域网IP> 下 navigator.mediaDevices 为 undefined
      if (!navigator.mediaDevices) {
        throw new Error(
          "navigator.mediaDevices 不可用：麦克风 API 仅在安全上下文（https:// 或 http://localhost）启用，请改用 localhost 或 dev:https 访问",
        );
      }
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

      onReady?.();
    } catch (error) {
      ended = true;
      cleanup();
      onError?.(error);
    }
  })();

  const stop = (): Promise<PcmRecorderResult | null> => {
    if (stopRequested) return stopPromise ?? Promise.resolve(null);
    stopRequested = true;
    stopPromise = (async () => {
      // stop() 可能在采集仍在启动时被调用：等待启动完成或失败
      await startupPromise.catch(() => undefined);
      if (ended) return null; // 启动失败或已取消

      cleanup();

      const durationSeconds = totalSamples / TARGET_SAMPLE_RATE;
      if (durationSeconds < MIN_DURATION_SECONDS) return null;

      const pcm = new Int16Array(totalSamples);
      let offset = 0;
      for (const frame of frames) {
        for (let i = 0; i < frame.length; i++) {
          const sample = Math.max(-1, Math.min(1, frame[i] ?? 0));
          pcm[offset + i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
        }
        offset += frame.length;
      }
      return { pcm: pcm.buffer, durationSeconds };
    })();
    return stopPromise;
  };

  const cancel = () => {
    ended = true;
    cleanup();
  };

  return { stop, cancel };
}
