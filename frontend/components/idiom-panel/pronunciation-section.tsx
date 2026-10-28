"use client";

import { RotateCcw, Volume2 } from "lucide-react";
import { cn } from "cn";
import { useTtsButton } from "@/components/correction-bubble/use-tts-button";
import type { CorrectionInput } from "@/lib/tts-client";
import type { EvaluationResult, EvaluationWord } from "@/lib/evaluation-client";

/**
 * 发音逐词分析 + 评分建议两展示区块（007 T006，FR-002/FR-003/FR-008；布局基准
 * frontend/docs/mockups/子功能-对话演示气泡-单击发音或地道-弹出更多信息弹窗.jpg
 * 上两区块，音频仅「美音」单路——英音/「我的」读法按用户 2026-10-27 拍板删除）。
 * 纯展示组件：数据经 props 传入（评测结果由 IdiomPanel 状态机获取），重读行为经
 * onRerecord 回调由 IdiomPanel 接管（US2）。
 */

/** 逐词着色（research R4）：≥85 优/绿、70~85 中/黄、<70 弱/红、无分不着色不编造（FR-008） */
/** 导出供 008 跟读评分视图复用着色规则（008 T003，唯一对外改动，零逻辑变更） */
export function wordToneClass(score: number | null): string {
  if (score == null) return "";
  if (score >= 85) return "text-green-600";
  if (score >= 70) return "text-amber-500";
  return "text-red-500";
}

function formatScore(score: number | null): string {
  return score != null ? String(Math.round(score)) : "--";
}

/** 综合分档位评语（确定性文案；research R5：本期 LLM 点评层常缺，不伪造点评） */
function tierComment(total: number | null): string {
  if (total == null) return "";
  if (total >= 90) return "发音很棒，继续保持！";
  if (total >= 75) return "整体不错，个别词还需加强。";
  if (total >= 60) return "有进步空间，多跟读美音示范。";
  return "别灰心，先听美音示范再重读一次。";
}

interface PronunciationSectionProps {
  messageId: string;
  /** 被评测句（用户原句）——美音示范播原句（research R4） */
  rawText: string;
  /** 真实纠错列表：raw TTS 请求后端会同时合成并缓存 :raw 与 :correct 两段，
   * 传真实列表保证 :correct 缓存与气泡工具栏 AI 发音同源（传空会污染缓存键） */
  corrections: CorrectionInput[];
  words: EvaluationWord[];
  showHint: (message: string) => void;
}

/** 发音逐词分析区块（FR-002）：原句逐词 + 质量标注 + 美音单路示范 */
export function PronunciationSection({
  messageId,
  rawText,
  corrections,
  words,
  showHint,
}: PronunciationSectionProps) {
  // 美音示范：复用 003 raw kind TTS 缓存键 `${messageId}:raw`（research R4，
  // 与纠错气泡工具栏「发音」按钮同键命中，零新增合成）
  const tts = useTtsButton(messageId, "raw", rawText, corrections, showHint);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h4 className="text-muted-foreground text-xs">发音逐词分析</h4>
        <button
          type="button"
          onClick={() => void tts.handlePlay()}
          disabled={tts.loading}
          aria-label="播放美音示范读音"
          className="flex cursor-pointer items-center gap-0.5 rounded-md px-0.5 py-0.5 text-xs transition-colors hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-50"
        >
          美音
          {tts.loading ? (
            <span className="size-3 animate-pulse rounded-full bg-current" aria-hidden />
          ) : (
            <Volume2
              className={cn("size-3.5", tts.status === "playing" && "text-green-600")}
              aria-hidden
            />
          )}
        </button>
      </div>
      {/* 逐词视图（FR-002/FR-008）：仅渲染评测实际覆盖的词，flags 角标 + title 说明；
          词间距用右距（inline-block 内的尾部空白会被折叠，不能用字符空格） */}
      <p className="mt-1.5 text-base leading-relaxed wrap-break-word">
        {words.map((w, index) => (
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
      <p className="text-muted-foreground/70 mt-1 text-[11px]">
        <span className="text-green-600">绿 优秀</span> ·{" "}
        <span className="text-amber-500">黄 一般</span> ·{" "}
        <span className="text-red-500">红 薄弱</span>（⚠ = 漏读/增读/替换等）
      </p>
    </div>
  );
}

interface ScoreAdviceSectionProps {
  result: EvaluationResult;
  /** 重读入口（US2）：未传时不渲染（无参考评分时重读无意义，FR-007） */
  onRerecord?: () => void;
}

/** 分数条颜色（与逐词着色同档位） */
function barToneClass(score: number | null): string {
  if (score == null) return "";
  if (score >= 85) return "bg-green-500";
  if (score >= 70) return "bg-amber-400";
  return "bg-red-400";
}

/** 评分建议区块（FR-003；2026-10-28 按预期图调整布局）：综合评分徽章 +
 *  流利度/发音分/完整度三行分数条 + 虚线分隔 + 档位评语 */
export function ScoreAdviceSection({ result, onRerecord }: ScoreAdviceSectionProps) {
  const comment = tierComment(result.total);
  const rows = [
    { label: "流利度", score: result.fluency },
    { label: "发音分", score: result.accuracy },
    { label: "完整度", score: result.integrity },
  ];
  return (
    <div className="mt-3.5">
      <div className="flex items-center justify-between">
        <h4 className="text-muted-foreground text-xs">评分建议</h4>
        {onRerecord && (
          <button
            type="button"
            onClick={onRerecord}
            aria-label="重新朗读并评分"
            className="text-muted-foreground hover:text-foreground flex cursor-pointer items-center gap-0.5 rounded-md px-0.5 py-0.5 text-xs transition-colors hover:bg-black/5"
          >
            <RotateCcw className="size-3" aria-hidden />
            重读
          </button>
        )}
      </div>
      {/* 综合评分徽章 */}
      <div className="mt-1.5 flex items-center gap-2.5">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full border-2 border-black/15 text-base font-semibold">
          {formatScore(result.total)}
        </div>
        <span className="text-sm font-medium">综合评分</span>
      </div>
      {/* 三项分数条（FR-003）：标签 + 分值 + 进度条（分值缺省时空条不编造） */}
      <div className="mt-3 space-y-2.5">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center gap-3">
            <span className="w-12 shrink-0 text-sm">{row.label}</span>
            <span className="w-7 shrink-0 text-sm tabular-nums">{formatScore(row.score)}</span>
            <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-black/10">
              {row.score != null && (
                <div
                  className={cn("h-full rounded-full", barToneClass(row.score))}
                  style={{ width: `${Math.min(100, Math.max(0, row.score))}%` }}
                />
              )}
            </div>
          </div>
        ))}
      </div>
      {/* 虚线分隔 + 文字建议（预期图二：建议区与分数条区隔开） */}
      {comment && (
        <>
          <div className="mt-3 border-t border-dashed border-black/15" />
          <p className="text-muted-foreground mt-2 text-xs">{comment}</p>
        </>
      )}
    </div>
  );
}
