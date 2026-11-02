"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { CircleHelp, X } from "lucide-react";
import { useLangChainState } from "@assistant-ui/react-langchain";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { PolishSection } from "./polish-section";
import { ScoreSection } from "./score-section";
import { type PopupAudioApi, usePopupAudio } from "./use-popup-audio";
import { WordAnalysisSection } from "./word-analysis-section";
import type { PopupSnapshot } from "./popup-store";

/**
 * 发音逐词分析信息弹窗（003-pronunciation-info-popup，原型图：
 * frontend/docs/mockups/子功能-对话演示气泡-单击发音或地道-弹出更多信息弹窗.jpg）。
 *
 * - Base UI Dialog + Portal，居中卡片式（参照 scene-select-popup.tsx 既有模式；
 *   Portal 内容随关闭卸载 → Tab/内部态自动复位，FR-014）；
 * - 数据：useLangChainState 读取线程 state 快照（contracts/state-data.md 全字段
 *   可缺省），**打开弹窗时复制进本地 state 冻结**——弹窗生命周期内不随后续
 *   values 流更新（"打开时刻快照"语义），关闭即丢弃；
 * - initialSection 锚点：analysis → 逐词区（顶部）、polish → 语境润色区（仅滚动定位差异）；
 * - 卸载清理：停止播放、loop 复位、revokeObjectURL（use-popup-audio.cleanup，FR-014）。
 */

export type PopupSection = "analysis" | "polish";

interface PronunciationPopupProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 打开时的初始定位区块（"发音" → 逐词区，"地道" → 润色区） */
  initialSection?: PopupSection;
}

export function PronunciationPopup({
  open,
  onOpenChange,
  initialSection = "analysis",
}: PronunciationPopupProps) {
  // 快照读取（hook 常驻开销低；冻结语义由 PopupContent 挂载时复制实现）
  const iseCheckResults =
    useLangChainState<PopupSnapshot["ise_check_results"]>("ise_check_results");
  const iseGrade = useLangChainState<PopupSnapshot["ise_grade"]>("ise_grade");
  const refText = useLangChainState<PopupSnapshot["ref_text"]>("ref_text");
  const rawText = useLangChainState<PopupSnapshot["raw_text"]>("raw_text");
  const polisher = useLangChainState<PopupSnapshot["polisher"]>("polisher");
  const iseStatus = useLangChainState<PopupSnapshot["ise_status"]>("ise_status");

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop
          className="fixed inset-0 isolate z-50 bg-black/40 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
          aria-hidden
        />
        <DialogPrimitive.Popup
          className={cn(
            "bg-secondary text-popover-foreground fixed left-1/2 top-1/2 z-50 flex max-h-[85dvh] w-[calc(100%-2rem)] max-w-[30rem] -translate-x-1/2 -translate-y-1/2 flex-col rounded-3xl shadow-lg outline-none duration-200",
            "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0",
          )}
        >
          <PopupContent
            snapshot={{
              ise_check_results: iseCheckResults,
              ise_grade: iseGrade,
              ref_text: refText,
              raw_text: rawText,
              polisher: polisher,
              ise_status: iseStatus,
            }}
            initialSection={initialSection}
          />
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/**
 * 弹窗内容子组件：状态定义在这一层（Portal 内容随关闭卸载）。
 * - 打开挂载时把 liveSnapshot 复制进本地 state 冻结（useState 初始化仅执行一次）；
 * - 卸载时调用播放器 cleanup（停止播放 / loop 复位 / revokeObjectURL）。
 */
function PopupContent({
  snapshot: liveSnapshot,
  initialSection,
}: {
  snapshot: PopupSnapshot;
  initialSection: PopupSection;
}) {
  const [snapshot] = useState(liveSnapshot); // 打开时刻快照冻结
  const audio: PopupAudioApi = usePopupAudio();
  const polishAnchorRef = useRef<HTMLDivElement | null>(null);

  // 卸载清理（关闭弹窗即触发，FR-014：无播放残留 / loop 复位 / URL 回收）
  useEffect(() => () => audio.cleanup(), [audio]);

  // 初始锚点：地道 → 滚动定位到语境润色区（发音默认顶部即逐词区）
  useEffect(() => {
    if (initialSection !== "polish") return;
    const frame = requestAnimationFrame(() => {
      polishAnchorRef.current?.scrollIntoView({ block: "start" });
    });
    return () => cancelAnimationFrame(frame);
  }, [initialSection]);

  return (
    <>
      {/* 标题栏：左标题 + 发音规则说明，右关闭 ×（原型图第一行） */}
      <div className="flex shrink-0 items-center gap-1.5 px-5 pt-4 pb-2">
        <DialogPrimitive.Title className="text-lg font-bold">发音逐词分析</DialogPrimitive.Title>
        <span
          className="text-muted-foreground flex cursor-help items-center gap-0.5 text-xs"
          title="颜色与标注规则：红色=待提高（<60 分）；橙色=小瑕疵（60~85 分）；绿色=很完美（≥85 分）；绿色波浪线=连读；绿色粗下划线=重读词"
        >
          发音规则
          <CircleHelp className="size-3.5" aria-hidden />
        </span>
        <DialogPrimitive.Close
          aria-label="关闭"
          className="text-muted-foreground hover:text-foreground ms-auto flex size-8 items-center justify-center rounded-full transition-colors"
        >
          <X className="size-4.5" />
        </DialogPrimitive.Close>
      </div>

      {/* 三大区块：逐词分析 / 评分建议 / 语境润色（原型图顺序），纵向滚动 */}
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 pt-1 pb-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <WordAnalysisSection snapshot={snapshot} audio={audio} />
        <ScoreSection snapshot={snapshot} />
        <div ref={polishAnchorRef} className="scroll-mt-2">
          <PolishSection snapshot={snapshot} audio={audio} />
        </div>
      </div>
    </>
  );
}
