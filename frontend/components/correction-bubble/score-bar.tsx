"use client";

import { ChevronRight } from "lucide-react";
import { cn } from "cn";
import { useHint } from "@/lib/use-hint";
import type { CorrectionMessageData } from "@/components/correction-bubble/correction-bubble";

/**
 * 气泡下方评分条（US6 T016，FR-011；数据模型 ScoreBarDisplay；006 T006 / 007 T008 更新）：
 * 语法纠错项=corrections 非空时展示静态标签；发音项=ise_grade 非空时展示数值；
 * 「地道」入口（006 FR-002）：有纠正句（corrections 非空，hasGrammar 守卫）时展示
 * ——点击打开语境润色弹窗（对纠正句按需生成，US2）；不显示分数（后端无地道评分
 * 数据源，R5 决议的分数部分延续，入口部分由 006 开启）；
 * onIdiomOpen 未传时不渲染入口（向后兼容零回归）。
 * 「发音」入口（007 FR-001）：onPronunciationOpen 提供时为真实入口（守卫
 * hasGrammar 与地道一致——主链 ise_grade 恒空（research R1），评测数据由面板
 * 打开后按需获取，文本输入场景由面板内部降级 FR-007）；未提供时保持占位行为
 * （仅 ise_grade 存在时显示"功能开发中"，向后兼容）。
 */
interface ScoreBarProps {
  data: CorrectionMessageData;
  onIdiomOpen?: () => void;
  onPronunciationOpen?: () => void;
}

export function ScoreBar({ data, onIdiomOpen, onPronunciationOpen }: ScoreBarProps) {
  const [hint, showHint] = useHint();
  const hasGrammar = data.corrections.length > 0;
  const hasPronunciation = data.ise_grade != null;

  // 三项全无数据不渲染（FR-011，避免空壳布局）
  if (!hasGrammar && !hasPronunciation) return null;

  return (
    <div className="mt-1.5 flex justify-end">
      <div className="bg-(--bubble-ai) text-foreground flex items-stretch gap-3 rounded-xl px-3.5 py-1.5 text-xs shadow-sm">
        {hasGrammar && (
          <div className="flex flex-col justify-center">
            <span className="font-medium">
              语法纠错<span className="text-red-500">!!</span>
            </span>
            <span className="text-muted-foreground">继续加油</span>
          </div>
        )}
        {/* 发音入口（007 FR-001）：真实入口与地道同守卫（hasGrammar）；
            未提供回调时回退 006 前占位（仅 ise_grade 存在时） */}
        {onPronunciationOpen && hasGrammar ? (
          <button
            type="button"
            onClick={onPronunciationOpen}
            aria-label="查看发音分析"
            className="flex cursor-pointer flex-col items-start justify-center rounded-md px-0.5 text-start transition-colors hover:bg-black/5"
          >
            <span className="font-medium">发音{data.ise_grade ?? ""}</span>
            <span className="text-muted-foreground flex items-center gap-0.5">
              发音分析
              <ChevronRight className="size-3" aria-hidden />
            </span>
          </button>
        ) : !onPronunciationOpen && hasPronunciation ? (
          <button
            type="button"
            onClick={() => showHint("功能开发中")}
            className="flex cursor-pointer flex-col items-start justify-center rounded-md px-0.5 text-start transition-colors hover:bg-black/5"
          >
            <span className="font-medium">发音{data.ise_grade}</span>
            <span className="text-muted-foreground flex items-center gap-0.5">
              发音分析
              <ChevronRight className="size-3" aria-hidden />
            </span>
          </button>
        ) : null}
        {/* 地道入口（006 FR-002）：有纠正句才显示，点击对纠正句按需生成地道表达 */}
        {onIdiomOpen && hasGrammar && (
          <button
            type="button"
            onClick={onIdiomOpen}
            aria-label="优化表达"
            className="flex cursor-pointer flex-col items-start justify-center rounded-md px-0.5 text-start transition-colors hover:bg-black/5"
          >
            <span className="font-medium">地道</span>
            <span className="text-muted-foreground flex items-center gap-0.5">
              优化表达
              <ChevronRight className="size-3" aria-hidden />
            </span>
          </button>
        )}
        {hint && (
          <span className={cn("text-muted-foreground flex items-center text-xs")}>{hint}</span>
        )}
      </div>
    </div>
  );
}
