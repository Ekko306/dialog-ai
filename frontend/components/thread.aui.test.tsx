import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { THREAD_MAX_WIDTH, isMostlyEnglish, SpeakMessageButton } from "@/components/thread.aui";

/**
 * SpeakMessageButton / THREAD_MAX_WIDTH / isMostlyEnglish 单测（气泡加宽 + 英文消息 TTS 播放按钮）：
 * - useAuiState 用受控 message state 驱动（替代 assistant-ui 运行时）；
 * - usePopupAudio mock 成受控 api，断言 play/stop 的调用参数与激活态渲染；
 * - profile-settings 用真实模块 + updateSettings，覆盖口音联动。
 */

const audioMock = vi.hoisted(() => ({
  play: vi.fn(),
  stop: vi.fn(),
  status: "idle" as "idle" | "loading" | "playing",
  activeKey: null as string | null,
  error: null as string | null,
}));

const useAuiStateMock = vi.hoisted(() => vi.fn());

vi.mock("@assistant-ui/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@assistant-ui/react")>()),
  useAuiState: useAuiStateMock,
}));

vi.mock("@/components/pronunciation-popup/use-popup-audio", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/pronunciation-popup/use-popup-audio")>()),
  usePopupAudio: vi.fn(() => ({
    status: audioMock.status,
    activeKey: audioMock.activeKey,
    error: audioMock.error,
    play: audioMock.play,
    stop: audioMock.stop,
  })),
}));

// TooltipIconButton 依赖 @base-ui/react 的 Tooltip（需 Provider），测试用轻量替身：
// 把 tooltip 透传为 title，保留 onClick/className 供断言
vi.mock("@/components/tooltip-icon-button", () => ({
  TooltipIconButton: ({
    tooltip,
    onClick,
    className,
    children,
  }: {
    tooltip: string;
    onClick?: (() => void) | undefined;
    className?: string | undefined;
    children: ReactNode;
  }) => (
    <button type="button" title={tooltip} onClick={onClick} className={className}>
      {children}
    </button>
  ),
}));

import { ttsSourceKey } from "@/components/pronunciation-popup/use-popup-audio";
import { updateSettings } from "@/lib/profile-settings";

/** 构造受控的 assistant-ui 消息 state（SpeakMessageButton 只读 message.content） */
const setMessageContent = (parts: ReadonlyArray<{ type: string; text?: string }>) => {
  useAuiStateMock.mockImplementation((selector: (s: unknown) => unknown) =>
    selector({ message: { content: parts } }),
  );
};

// vitest globals:false 下 testing-library 不自动清理，手动卸载避免跨测试 DOM 残留
afterEach(cleanup);

beforeEach(() => {
  audioMock.play.mockReset();
  audioMock.stop.mockReset();
  audioMock.status = "idle";
  audioMock.activeKey = null;
  audioMock.error = null;
  updateSettings({ accent: "american" });
  setMessageContent([{ type: "text", text: "" }]);
});

describe("THREAD_MAX_WIDTH（气泡加宽）", () => {
  it("加宽后的对话列宽度为 52rem，main-chat-page 底部输入区与之同步", () => {
    // main-chat-page 的 max-w-[52rem] 是字面量，无法跨模块断言；
    // 以本常量为契约锚点：若调整宽度需同步更新两处（见常量注释）
    expect(THREAD_MAX_WIDTH).toBe("52rem");
  });
});

describe("isMostlyEnglish（英文消息判定）", () => {
  it("纯英文句子 → true", () => {
    expect(isMostlyEnglish("I like learning English very much.")).toBe(true);
  });

  it("纯中文句子 → false", () => {
    expect(isMostlyEnglish("你好，今天天气不错，我们出去玩吧。")).toBe(false);
  });

  it("拉丁字母不足 3 个 → false（如 hi、OK）", () => {
    expect(isMostlyEnglish("hi")).toBe(false);
    expect(isMostlyEnglish("OK")).toBe(false);
  });

  it("空文本/仅标点 → false", () => {
    expect(isMostlyEnglish("")).toBe(false);
    expect(isMostlyEnglish("...!?")).toBe(false);
  });

  it("以英文为主的混排（教练纠错回复）→ true", () => {
    expect(isMostlyEnglish("You can say: I like apples. 记住要用复数形式哦。")).toBe(true);
  });

  it("以中文为主、夹少量英文 → false", () => {
    expect(isMostlyEnglish("这句话正确的说法是 I like apples，注意单复数问题。")).toBe(false);
  });
});

describe("SpeakMessageButton（AI 英文消息固定播放按钮）", () => {
  it("英文消息渲染播放按钮，点击即以当前口音发起单次 TTS 播放（loop:false 覆盖）", () => {
    const text = "Hello world today";
    setMessageContent([{ type: "text", text }]);
    render(<SpeakMessageButton />);

    fireEvent.click(screen.getByTitle("播放语音"));

    expect(audioMock.play).toHaveBeenCalledTimes(1);
    expect(audioMock.play).toHaveBeenCalledWith(
      { kind: "tts", text, accent: "american" },
      { loop: false },
    );
    expect(audioMock.stop).not.toHaveBeenCalled();
  });

  it("口音跟随「我的」设置（british）", () => {
    updateSettings({ accent: "british" });
    const text = "Please practice this sentence";
    setMessageContent([{ type: "text", text }]);
    render(<SpeakMessageButton />);

    fireEvent.click(screen.getByTitle("播放语音"));
    expect(audioMock.play).toHaveBeenCalledWith(
      { kind: "tts", text, accent: "british" },
      { loop: false },
    );
  });

  it("播放中（激活态）按钮显示停止态：再点调用 stop 且不再触发 play", () => {
    const text = "Hello world today";
    setMessageContent([{ type: "text", text }]);
    audioMock.status = "playing";
    audioMock.activeKey = ttsSourceKey("american", text);
    render(<SpeakMessageButton />);

    const button = screen.getByTitle("停止播放");
    expect(button.className).toContain("text-(--icon-brand-green)");

    fireEvent.click(button);
    expect(audioMock.stop).toHaveBeenCalledTimes(1);
    expect(audioMock.play).not.toHaveBeenCalled();
  });

  it("合成中（loading）渲染转圈图标", () => {
    const text = "Hello world today";
    setMessageContent([{ type: "text", text }]);
    audioMock.status = "loading";
    audioMock.activeKey = ttsSourceKey("american", text);
    const { container } = render(<SpeakMessageButton />);

    expect(screen.getByTitle("停止播放")).toBeTruthy();
    expect(container.querySelector("svg.animate-spin")).toBeTruthy();
  });

  it("纯中文消息不渲染按钮（不影响中文消息展示）", () => {
    setMessageContent([{ type: "text", text: "你好，今天天气不错，我们出去玩吧。" }]);
    const { container } = render(<SpeakMessageButton />);
    expect(container.querySelector("button")).toBeNull();
  });

  it("拉丁字母不足 3 的短消息不渲染按钮", () => {
    setMessageContent([{ type: "text", text: "OK" }]);
    const { container } = render(<SpeakMessageButton />);
    expect(container.querySelector("button")).toBeNull();
  });

  it("无文本消息（纯工具调用轮）不渲染按钮", () => {
    setMessageContent([{ type: "tool-call" }]);
    const { container } = render(<SpeakMessageButton />);
    expect(container.querySelector("button")).toBeNull();
  });

  it("多 text part 拼接后再判定（分段回复）", () => {
    setMessageContent([
      { type: "text", text: "Good sentence! " },
      { type: "text", text: "Pronunciation sounds natural." },
    ]);
    render(<SpeakMessageButton />);

    const expected = "Good sentence! \nPronunciation sounds natural.";
    fireEvent.click(screen.getByTitle("播放语音"));
    expect(audioMock.play).toHaveBeenCalledWith(
      { kind: "tts", text: expected, accent: "american" },
      { loop: false },
    );
  });
});
