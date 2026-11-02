"use client";

import { CheckIcon, CopyIcon, MicIcon, StarIcon, Volume2 } from "lucide-react";
import { useEffect, useReducer, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { isFavorite, toggleFavorite, type PopupSnapshot, type StylePolish } from "./popup-store";
import { type PopupAudioApi, ttsSourceKey } from "./use-popup-audio";

/**
 * 语境润色区块（US3，原型图第三卡）：三风格 Tab + 内容 + 工具行 + AI 生成标注。
 *
 * - Tab：地道美式（默认选中）/ 商务正式 / 地道英式，选中态绿色下划线；切换即时更新
 *   不刷新（SC-005）；关闭弹窗即卸载复位到"地道美式"（FR-014）；
 * - Tab 映射（contracts/state-data.md）：american ← polished_text/explanation、
 *   business ← style_business、british ← style_british；单风格缺失 → 该 Tab 空态，
 *   不影响其他 Tab；polish_status !== "success" → 全区块空态（FR-010/015）；
 * - 工具行：循环跟读（audio.loop 开关 + 激活态）、复制（剪贴板 + 成功反馈）、
 *   收藏（内存 Set，键=polishedText）、AI 朗读；polishedText 为空时全部置灰
 *   （FR-011/012/013/015）。
 */

type StyleKey = "american" | "business" | "british";

const STYLE_TABS: ReadonlyArray<{ key: StyleKey; label: string }> = [
  { key: "american", label: "地道美式" },
  { key: "business", label: "商务正式" },
  { key: "british", label: "地道英式" },
];

interface StyleContent {
  text: string | null;
  explanation: string | null;
}

const EMPTY_STYLE: StyleContent = { text: null, explanation: null };

const fromStylePolish = (style: StylePolish | null | undefined): StyleContent =>
  style?.polished_text
    ? { text: style.polished_text, explanation: style.explanation || null }
    : EMPTY_STYLE;

export function PolishSection({
  snapshot,
  audio,
}: {
  snapshot: PopupSnapshot;
  audio: PopupAudioApi;
}) {
  const polisher = snapshot.polisher;
  const statusOk = polisher?.polish_status === "success";

  const styles: Record<StyleKey, StyleContent> = {
    american:
      statusOk && polisher?.polished_text
        ? { text: polisher.polished_text, explanation: polisher.explanation || null }
        : EMPTY_STYLE,
    business: fromStylePolish(polisher?.style_business),
    british: fromStylePolish(polisher?.style_british),
  };

  const [activeTab, setActiveTab] = useState<StyleKey>("american");
  const current = styles[activeTab];

  return (
    <section data-slot="pronunciation-polish">
      <h2 className="px-1 text-base font-bold">语境润色</h2>
      <div className="mt-2 rounded-2xl bg-background p-4 shadow-sm">
        {statusOk ? (
          <>
            {/* 三风格 Tab 行：选中态绿色下划线高亮（原型图） */}
            <div className="flex gap-5 border-b border-black/5" role="tablist">
              {STYLE_TABS.map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === key}
                  onClick={() => setActiveTab(key)}
                  className={cn(
                    "-mb-px border-b-2 pb-2 text-sm transition-colors",
                    activeTab === key
                      ? "border-(--icon-brand-green) text-foreground font-semibold"
                      : "text-muted-foreground border-transparent hover:text-foreground/80",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            <PolishContent
              key={activeTab} // 切 Tab 重置工具行内部态（复制成功反馈等）
              content={current}
              audio={audio}
            />
          </>
        ) : (
          <p className="text-muted-foreground py-8 text-center text-sm">本轮没有润色数据</p>
        )}
      </div>
    </section>
  );
}

function PolishContent({ content, audio }: { content: StyleContent; audio: PopupAudioApi }) {
  const text = content.text;

  // 复制成功反馈：图标短暂切换为 ✓（参照 thread.aui 的 Copy 模式）
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    [],
  );

  // 收藏态：模块 Set 为事实来源，forceRender 触发重读（切 Tab 后仍正确）
  const [, forceRender] = useReducer((count: number) => count + 1, 0);
  const favorited = text !== null && isFavorite(text);

  const source = text ? ({ kind: "tts", text, accent: "american" } as const) : null;
  const activeKey = text ? ttsSourceKey("american", text) : null;
  const isLoopingThis = audio.loop && audio.activeKey === activeKey && audio.status !== "idle";

  const handleCopy = () => {
    if (!text) return;
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1500);
    });
  };

  const handleLoop = () => {
    if (!source) return;
    if (isLoopingThis) {
      audio.setLoop(false);
      audio.stop();
    } else {
      audio.setLoop(true);
      audio.play(source);
    }
  };

  const handleAiPlay = () => {
    if (!source) return;
    audio.setLoop(false);
    audio.play(source);
  };

  return (
    <>
      {/* 工具行（原型图：🎤循环跟读 ⧉复制 ☆收藏 | AI🔊） */}
      <div className="mt-3 flex items-center gap-4 text-sm">
        <ToolButton label="循环跟读" disabled={!text} active={isLoopingThis} onClick={handleLoop}>
          <MicIcon className="size-3.5" aria-hidden />
        </ToolButton>
        <ToolButton
          label={copied ? "已复制" : "复制"}
          disabled={!text}
          active={copied}
          onClick={handleCopy}
        >
          {copied ? (
            <CheckIcon className="size-3.5" aria-hidden />
          ) : (
            <CopyIcon className="size-3.5" aria-hidden />
          )}
        </ToolButton>
        <ToolButton
          label="收藏"
          disabled={!text}
          active={favorited}
          onClick={() => {
            if (!text) return;
            toggleFavorite(text);
            forceRender();
          }}
        >
          <StarIcon className={cn("size-3.5", favorited && "fill-current")} aria-hidden />
        </ToolButton>
        <span className="text-muted-foreground/50" aria-hidden>
          |
        </span>
        <ToolButton
          label="AI"
          disabled={!text}
          active={audio.activeKey === activeKey && audio.status !== "idle"}
          onClick={handleAiPlay}
        >
          <Volume2 className="size-4" aria-hidden />
        </ToolButton>
      </div>

      {/* 内容：优化句 + 中文解释（保留换行排版，FR-011/012）；单风格缺失 → 空态 */}
      {text ? (
        <div className="text-foreground mt-3 space-y-2 text-sm leading-relaxed">
          <p className="whitespace-pre-wrap wrap-break-word">
            <span className="text-muted-foreground">优化后的句子：</span>
            {text}
          </p>
          {content.explanation && (
            <p className="whitespace-pre-wrap wrap-break-word">
              <span className="text-muted-foreground">修改解释：</span>
              {content.explanation}
            </p>
          )}
        </div>
      ) : (
        <p className="text-muted-foreground py-6 text-center text-sm">该风格暂无润色结果</p>
      )}

      <p className="text-muted-foreground/70 mt-4 text-center text-xs">内容由 AI 生成</p>

      {/* 播放/合成错误外显（FR-015 不静默失败） */}
      {audio.error && <p className="mt-2 text-center text-xs text-red-500">{audio.error}</p>}
    </>
  );
}

function ToolButton({
  label,
  disabled,
  active,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex items-center gap-1 transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        active
          ? "text-(--icon-brand-green) font-medium"
          : "text-foreground hover:text-foreground/70",
      )}
    >
      {children}
      {label}
    </button>
  );
}
