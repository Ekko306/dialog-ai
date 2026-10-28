"use client";

import { ChevronRight } from "lucide-react";

/**
 * 润色气泡评分条（005 T011，FR-007，analyze C2 决议；006 T004 更新）：
 * 润色分支恒有「语法正确」数据（本分支判定前提即语法无误）→ 恒渲染该项；
 * 发音项无评测数据源（ISE 仅纠错分支产出，R5 同类决议：无数据不渲染）；
 * 「地道」入口（006 FR-001）：恒显示（润色气泡恒有润色结果）、不显示分数
 * （后端无地道评分数据源，spec Assumptions），点击回调由 onIdiomOpen 注入，
 * 未传时不渲染入口（向后兼容零回归）。
 * 独立小组件而非复用 ScoreBar：ScoreBar 语法项文案为「语法纠错!!/继续加油」且
 * corrections=[] ∧ ise_grade=null 时整体返回 null，与 FR-007「必须展示语法正确 ✓」不符。
 */
interface PolisherScoreBarProps {
  onIdiomOpen?: () => void;
}

export function PolisherScoreBar({ onIdiomOpen }: PolisherScoreBarProps) {
  return (
    <div className="mt-1.5 flex justify-end">
      <div className="bg-(--bubble-ai) text-foreground flex items-stretch gap-3 rounded-xl px-3.5 py-1.5 text-xs shadow-sm">
        <div className="flex flex-col justify-center">
          <span className="font-medium">
            语法正确<span className="text-green-600"> ✓</span>
          </span>
          <span className="text-muted-foreground">太棒了</span>
        </div>
        {/* 地道入口（006 FR-001）：点击打开语境润色弹窗（US1） */}
        {onIdiomOpen && (
          <button
            type="button"
            onClick={onIdiomOpen}
            aria-label="查看地道表达"
            className="flex cursor-pointer flex-col items-start justify-center rounded-md px-0.5 text-start transition-colors hover:bg-black/5"
          >
            <span className="font-medium">地道</span>
            <span className="text-muted-foreground flex items-center gap-0.5">
              更多语境
              <ChevronRight className="size-3" aria-hidden />
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
