import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { popupAudioApi, ttsSourceKey } from "@/components/pronunciation-popup/use-popup-audio";

/**
 * TTS 单例引擎（use-popup-audio）单测：
 * - 消息播放按钮新增的 opts.loop 按次覆盖（恒单次，不跟随 loopDefault）；
 * - (text, accent) URL 缓存去重（重复播放零二次合成延迟）；
 * - stop 使进行中的合成失效（seq 失效）；失败透出后端 detail（FR-015）。
 *
 * 引擎是模块级单例，依赖浏览器能力：Audio 构造、fetch、URL.createObjectURL
 * 均在测试内打桩；server-dictation-adapter 与 profile-settings mock 掉。
 */

vi.mock("@/lib/profile-settings", () => ({
  getSettings: () => ({
    accent: "american" as const,
    loopDefault: false,
    ttsEnabled: true,
  }),
}));

vi.mock("@/components/server-dictation-adapter", () => ({
  getLastRecording: vi.fn(() => null),
  pcmToWavBlob: vi.fn(),
}));

/** 可控的 <audio> 替身：记录 loop/src，play 可编程 resolve/reject */
class FakeAudio {
  loop = false;
  src = "";
  static instances: FakeAudio[] = [];
  play = vi.fn(() => Promise.resolve());
  pause = vi.fn();
  addEventListener = vi.fn();
  removeEventListener = vi.fn();

  constructor() {
    FakeAudio.instances.push(this);
  }
}

let fetchMock: ReturnType<typeof vi.fn>;

const audioElement = () => {
  const el = FakeAudio.instances.at(-1);
  if (!el) throw new Error("FakeAudio 尚未实例化（play 未被调用）");
  return el;
};

/** 等待引擎状态到达目标值（合成是异步链） */
const waitFor = async (predicate: () => boolean) => {
  for (let i = 0; i < 50; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("waitFor 超时：状态未到达预期值");
};

beforeEach(() => {
  // 注意：引擎的 audioEl 是模块级单例，跨测试复用且在首个 play 时才实例化；
  // 不能清空 instances 表，否则 audioElement() 找不到此前测试创建的实例
  vi.stubGlobal("Audio", FakeAudio);

  // 仅替换静态方法（引擎只用 createObjectURL/revokeObjectURL），保留 URL 构造能力
  let blobSeq = 0;
  const FakeURL = class extends URL {};
  FakeURL.createObjectURL = vi.fn(() => `blob:fake-${++blobSeq}`);
  FakeURL.revokeObjectURL = vi.fn();
  vi.stubGlobal("URL", FakeURL);

  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  popupAudioApi.cleanup();
  vi.unstubAllGlobals();
});

/** 配置 fetch 返回一段可播放的音频响应 */
const mockTtsOk = () => {
  fetchMock.mockResolvedValue({
    ok: true,
    blob: () => Promise.resolve(new Blob(["audio-bytes"])),
  });
};

describe("TTS 引擎 play 的 loop 语义（消息播放按钮契约）", () => {
  it("opts.loop=false 按次覆盖：即使 loop 开关开启，消息播放也恒为单次", async () => {
    popupAudioApi.setLoop(true); // 模拟弹窗内循环跟读开启 / loopDefault=true
    mockTtsOk();
    popupAudioApi.play(
      { kind: "tts", text: "Practice makes perfect", accent: "british" },
      { loop: false },
    );

    await waitFor(() => popupAudioApi.status === "playing");
    expect(audioElement().loop).toBe(false);
  });

  it("不传 opts 时跟随引擎 loop 开关（弹窗循环跟读语义不变）", async () => {
    const api = popupAudioApi;
    mockTtsOk();

    api.setLoop(true);
    api.play({ kind: "tts", text: "Loop me please", accent: "american" });
    await waitFor(() => api.status === "playing");
    expect(audioElement().loop).toBe(true);

    api.setLoop(false);
    api.play({ kind: "tts", text: "Loop me please", accent: "american" });
    await waitFor(() => api.status === "playing");
    expect(audioElement().loop).toBe(false);
  });
});

describe("TTS 缓存与请求", () => {
  it("同 (text, accent) 重复播放命中缓存：只发一次 /api/audio/tts", async () => {
    mockTtsOk();
    const api = popupAudioApi;
    const source = { kind: "tts" as const, text: "Nice to meet you", accent: "american" as const };

    api.play(source);
    await waitFor(() => api.status === "playing");
    api.stop();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    api.play(source);
    await waitFor(() => api.status === "playing");
    expect(fetchMock).toHaveBeenCalledTimes(1); // 第二次走缓存，不再合成
  });

  it("activeKey 与 ttsSourceKey 同规则（按钮激活判定契约）", async () => {
    mockTtsOk();
    const api = popupAudioApi;
    const text = "Same key contract";
    api.play({ kind: "tts", text, accent: "british" });

    await waitFor(() => api.status !== "loading");
    expect(api.activeKey).toBe(ttsSourceKey("british", text));
  });

  it("stop 使进行中的合成失效：请求返回后不再进入 playing", async () => {
    let resolveFetch: ((value: unknown) => void) | undefined;
    fetchMock.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );
    const api = popupAudioApi;
    api.play({ kind: "tts", text: "Slow synthesis", accent: "american" });
    expect(api.status).toBe("loading");

    api.stop();
    expect(api.status).toBe("idle");
    resolveFetch?.({ ok: true, blob: () => Promise.resolve(new Blob(["late"])) });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(api.status).toBe("idle"); // 未被迟到结果污染
  });
});

describe("TTS 失败外显（FR-015 不静默失败）", () => {
  it("后端 detail（含纯中文）原样透出", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ detail: "british 口音发音人未配置" }),
    });
    const api = popupAudioApi;
    api.play({ kind: "tts", text: "Broken accent", accent: "british" });

    await waitFor(() => api.error !== null);
    expect(api.error).toBe("british 口音发音人未配置");
    expect(api.status).toBe("idle");
  });
});
