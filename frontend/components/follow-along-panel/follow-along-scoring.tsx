"use client";

import { cn } from "cn";
import { ScoreAdviceSection, wordToneClass } from "@/components/idiom-panel/pronunciation-section";
import type { EvaluationResult } from "@/lib/evaluation-client";

/**
 * 跟读评分视图（008 T004，US1 FR-004；装配层，research R4）：
 * 逐词着色的跟读句 + ScoreAdviceSection 原样复用（综合评分徽章 + 流利度/发音分/
 * 完整度三行分数条 + 虚线分隔文字建议 + 标题行重读入口）。
 * 与 007 发音逐词分析的差异：不渲染「美音」按钮与图例行（图二布局——示范播放由
 * 跟读面板既有中央播放键承担，:correct TTS 已缓存）；着色规则复用同一 wordToneClass。
 * 评测结果仅在本面板内展示（FR-008），不写 evaluationCache（contracts §1 红线）。
 */

interface FollowAlongScoringProps {
  /** 最新评测结果（重读成功后覆盖） */
  result: EvaluationResult;
  /** 「重读」回调：回到录音操作区开始新一轮（US2） */
  onRerecord: () => void;
}

export function FollowAlongScoring({ result, onRerecord }: FollowAlongScoringProps) {
  return (
    <div className="mt-3.5">
      {/* 逐词着色句（FR-004）：仅渲染评测实际覆盖的词，flags 角标 + title 说明；
          词间距用右距（inline-block 内尾部空白会被折叠，不能用字符空格） */}
      <p className="text-base leading-relaxed wrap-break-word">
        {result.words.map((w, index) => (
          <span
            key={`${w.word}-${index}`}
            className={cn("mr-2 inline-block", wordToneClass(w.score))}
          >
            {w.word}
            {w.flags.length > 0 && (
              <sup className="text-[10px] text-red-500" title={w.flags.join("、")}>
                ⚠
              </sup>
            )}
          </span>
        ))}
      </p>

      {/* 评分建议区块：徽章 + 三行分数条 + 虚线 + 文字建议 + 标题行「重读」 */}
      <ScoreAdviceSection result={result} onRerecord={onRerecord} />
    </div>
  );
}
