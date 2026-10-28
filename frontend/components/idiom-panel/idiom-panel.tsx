"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Copy, Mic, Star, Volume2, X } from "lucide-react";
import { cn } from "cn";
import { CorrectionBubbleFollowAlong } from "@/components/follow-along-panel/follow-along-panel";
import { useTtsButton } from "@/components/correction-bubble/use-tts-button";
import { useAudioPlayback } from "@/lib/audio-manager";
import { useHint } from "@/lib/use-hint";
import {
  evaluationCache,
  fetchEvaluation,
  recordingStore,
  type EvaluationResult,
} from "@/lib/evaluation-client";
import {
  getCachedOnDemandPolish,
  getOnDemandPolish,
  getPanelPolishAudioUrl,
  type OnDemandPolish,
} from "@/lib/polisher-bypass-client";
import type { CorrectionInput } from "@/lib/tts-client";
import {
  PronunciationSection,
  ScoreAdviceSection,
} from "@/components/idiom-panel/pronunciation-section";
import { RerecordBox } from "@/components/idiom-panel/rerecord-box";

/**
 * 弹窗壳（006 T003 创建，007 T007/T010 扩展为完整三区块面板）：
 * - mode="polisher"（润色气泡）：行为与 006 完全一致（语境润色单区块，即时数据）；
 * - mode="correction"（纠错气泡，007 FR-001）：完整三区块面板——发音逐词分析 +
 *   评分建议（评测数据按需获取，data-model.md 六态状态机）+ 语境润色（006 按需
 *   润色链路不变），「发音」与「地道」两入口共用本面板。
 *
 * 评测状态机（007，仅 correction 模式 + rawText 存在时）：
 *   打开 → evaluationCache 命中 → ready；
 *        → recordingStore 无本轮录音 → no_recording（降级文案，重读隐藏，FR-007）；
 *        → 有录音 → loading（评测中…）→ fetchEvaluation → ready（写缓存）
 *          / failed（行内重试=同一 PCM 重发，FR-006）；
 *   ready → 「↻ 重读」→ rerecording（录音操作区）→ 新 PCM → loading → 覆盖写
 *   evaluationCache → ready（评分/逐词刷新）；取消回 ready。
 *   红线（FR-005/research R6）：重读结果仅写 evaluationCache 并注入本面板 props，
 *   不写对话线程、不回写气泡评分条。
 */

export type IdiomPanelMode = "polisher" | "correction";

/** 评测区状态机（data-model.md；idle 为理论瞬态省略，打开即评） */
type EvalStatus = "no_recording" | "loading" | "ready" | "failed" | "rerecording";

interface IdiomPanelProps {
  open: boolean;
  onClose: () => void;
  messageId: string;
  mode: IdiomPanelMode;
  /** polisher 模式（US1 即时数据路径）：润色句 / 修改解释 / 语境原句 */
  polishedText?: string;
  explanation?: string;
  contextRawText?: string;
  /** correction 模式（US2 按需数据路径）：纠正后的完整句（润色输入） */
  correctedSentence?: string;
  /** correction 模式（007 FR-002）：被评测句（用户原句）；缺省不渲染评测区 */
  rawText?: string;
  /** correction 模式（007）：真实纠错列表——美音 TTS 请求会同时合成并缓存
   * :raw 与 :correct 两段，传真实列表保证 :correct 缓存与气泡工具栏同源 */
  corrections?: CorrectionInput[];
}

// 风格标签栏（FR-008，2026-10-27 人工验收拍板）：仅保留「地道美式」单项，
// 商务正式/地道英式占位删除（多风格需后端生成扩展，后置）；保留数组形式便于后续扩展
const STYLE_TABS = ["地道美式"] as const;
const ACTIVE_STYLE = STYLE_TABS[0];

export function IdiomPanel({
  open,
  onClose,
  messageId,
  mode,
  polishedText = "",
  explanation = "",
  contextRawText = "",
  correctedSentence = "",
  rawText = "",
  corrections = [],
}: IdiomPanelProps) {
  const [hint, showHint] = useHint();
  const [copied, setCopied] = useState(false);
  // correction 模式按需状态机（data-model.md：idle→loading→ready/failed）
  const [onDemand, setOnDemand] = useState<OnDemandPolish | null>(null);
  const [demandStatus, setDemandStatus] = useState<"idle" | "loading" | "ready" | "failed">("idle");
  // correction 模式发音（R2 自有缓存路径）
  const [panelAudioLoading, setPanelAudioLoading] = useState(false);
  const play = useAudioPlayback((s) => s.play);
  const panelSourceId = `${messageId}:panel-polish`;
  const panelAudioStatus = useAudioPlayback((s) =>
    s.sourceId === panelSourceId ? s.status : "idle",
  );

  // ===== 007 评测状态机（correction 模式专用） =====
  const [evalStatus, setEvalStatus] = useState<EvalStatus>("no_recording");
  const [evaluation, setEvaluation] = useState<EvaluationResult | null>(null);
  const [evalError, setEvalError] = useState("");
  // 重试/重读共用：最近一次待评测 PCM（失败重发同段音频，契约「前端消费规则」）
  const pcmRef = useRef<ArrayBuffer | null>(null);

  const requestEvaluation = useCallback(
    (pcm: ArrayBuffer) => {
      if (!rawText) return;
      setEvalStatus("loading");
      setEvalError("");
      fetchEvaluation(pcm, rawText)
        .then((result) => {
          evaluationCache.set(messageId, result); // 首评写入 / 重读覆盖写（FR-005）
          setEvaluation(result);
          setEvalStatus("ready");
        })
        .catch((error: unknown) => {
          setEvalError(error instanceof Error ? error.message : "评测失败，请重试");
          setEvalStatus("failed");
        });
    },
    [messageId, rawText],
  );

  // 打开时按需评测（correction 模式）：缓存命中直显；无录音降级；有录音发起评测
  useEffect(() => {
    if (!open || mode !== "correction" || !rawText) return;
    const cached = evaluationCache.get(messageId);
    if (cached) {
      setEvaluation(cached);
      setEvalStatus("ready");
      return;
    }
    // 查找键 trim（与写入侧一致，防 IAT 尾随空白 / composer trim 导致失配）；
    // 精确未命中但会话内仅有一条录音时兜底使用（覆盖文本被微调、热重载后
    // Map 键残留不一致等场景）；多条并存时不猜（保持消息间隔离，FR-007）
    let pcm = recordingStore.get(rawText.trim());
    if (!pcm && recordingStore.size === 1) {
      pcm = recordingStore.values().next().value ?? undefined;
    }
    if (!pcm) {
      setEvalStatus("no_recording"); // 文本输入/刷新后/文本被改写（FR-007）
      return;
    }
    pcmRef.current = pcm;
    requestEvaluation(pcm);
  }, [open, mode, messageId, rawText, requestEvaluation]);

  // 重读链路（US2）：录音操作区 → 新 PCM 重新评测（不回写气泡/线程）
  const handleRerecorded = (pcm: ArrayBuffer) => {
    pcmRef.current = pcm;
    requestEvaluation(pcm);
  };

  // polisher 模式发音（与 005 操作栏同句同键，useTtsButton 缓存命中零合成）
  const polishAsCorrection: CorrectionInput[] = [
    { wrong: contextRawText, correct: polishedText, type: "polish" },
  ];
  const tts = useTtsButton(messageId, "correct", contextRawText, polishAsCorrection, showHint);

  // 按需生成（correction 模式）：打开时缓存命中直显，未命中发起旁路请求（FR-005/FR-007）
  const requestPolish = useCallback(() => {
    if (!correctedSentence) {
      setDemandStatus("failed");
      return;
    }
    setDemandStatus("loading");
    getOnDemandPolish(messageId, correctedSentence)
      .then((result) => {
        setOnDemand(result);
        setDemandStatus("ready");
      })
      .catch(() => {
        setDemandStatus("failed");
      });
  }, [messageId, correctedSentence]);

  useEffect(() => {
    if (!open || mode !== "correction") return;
    const cached = getCachedOnDemandPolish(messageId);
    if (cached) {
      setOnDemand(cached);
      setDemandStatus("ready");
      return;
    }
    // 卸载/关闭仅中断状态更新，不中断请求：结果照常写缓存（Edge Case ②）
    requestPolish();
  }, [open, mode, messageId, requestPolish]);

  // 双模式统一的活动内容（即时路径取 props，按需路径取请求结果）
  const activePolished = mode === "polisher" ? polishedText : (onDemand?.polished_text ?? "");
  const activeExplanation = mode === "polisher" ? explanation : (onDemand?.explanation ?? "");
  const activeContext = mode === "polisher" ? contextRawText : correctedSentence;
  const activeAsCorrection: CorrectionInput[] = [
    { wrong: activeContext, correct: activePolished, type: "polish" },
  ];
  const openFollowAlong = CorrectionBubbleFollowAlong.useOpen();

  const handleCopy = async () => {
    if (!activePolished) return;
    try {
      await navigator.clipboard.writeText(activePolished);
    } catch {
      // Clipboard API 被拒时 execCommand 兜底（003/005 handleCopy 同款）
      const ta = document.createElement("textarea");
      ta.value = activePolished;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      if (!ok) {
        showHint("复制失败，请手动选择文本");
        return;
      }
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // correction 模式发音：getPanelPolishAudioUrl 自有缓存键（禁止 getTtsAudioUrl，R2 红线）
  const handlePanelPlay = async () => {
    if (panelAudioLoading || !correctedSentence || !activePolished) return;
    setPanelAudioLoading(true);
    try {
      const url = await getPanelPolishAudioUrl(messageId, correctedSentence, activePolished);
      if (!url) {
        showHint("发音获取失败，请稍后重试");
        return;
      }
      await play(panelSourceId, url);
    } catch {
      showHint("发音获取失败，请稍后重试");
    } finally {
      setPanelAudioLoading(false);
    }
  };

  if (!open) return null;

  const contentReady = mode === "polisher" || demandStatus === "ready";
  const hasEvalArea = mode === "correction" && Boolean(rawText);
  const panelTitle = mode === "polisher" ? "语境润色" : "发音分析";

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      {/* 遮罩（FR-010 关闭方式之一） */}
      <button
        type="button"
        aria-label="关闭弹窗"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/40"
      />
      {/* 底部弹出面板：限高 85vh + 标题行固定 + 内容区滚动
          （否则内容超高时面板被 items-end 顶出屏幕，标题/× 不可见） */}
      <div className="bg-background relative flex max-h-[85vh] w-full max-w-md flex-col rounded-t-2xl p-4 shadow-lg">
        {/* 标题行 + ×（FR-010 关闭方式之二）；correction 模式=完整面板，标题改「发音分析」 */}
        <div className="flex shrink-0 items-center justify-between">
          <h3 className="text-sm font-semibold">{panelTitle}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="text-muted-foreground hover:text-foreground cursor-pointer rounded-md p-1 transition-colors hover:bg-black/5"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>

        {/* 可滚动内容区（标题行保持可见） */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {/* ===== 007 评测区（correction 模式，FR-003/FR-006/FR-007） ===== */}
          {hasEvalArea && (
            <div className={cn(evaluation && evalStatus === "ready" && "mt-3.5")}>
              {evalStatus === "no_recording" && (
                /* 无本轮录音降级（FR-007）：文本输入/刷新后；重读入口不出现 */
                <p className="text-muted-foreground mt-3.5 text-sm">未找到本次录音，无法评测发音</p>
              )}
              {evalStatus === "loading" && (
                /* 评测进行中反馈（FR-006），约 1~2s（quickstart §1.4） */
                <p className="text-muted-foreground mt-3.5 flex items-center gap-1.5 text-sm">
                  <span className="inline-block size-1.5 animate-pulse rounded-full bg-current" />
                  评测中…
                </p>
              )}
              {evalStatus === "failed" && (
                /* 失败行内重试（FR-006）：被拒/无效结果文案来自契约（EvaluationError） */
                <div className="mt-3.5 py-2 text-center">
                  <p className="text-sm text-red-500">{evalError || "评测失败"}</p>
                  <button
                    type="button"
                    onClick={() => {
                      if (pcmRef.current) requestEvaluation(pcmRef.current);
                    }}
                    className="text-muted-foreground hover:text-foreground mt-1.5 cursor-pointer text-sm"
                  >
                    重新评测
                  </button>
                </div>
              )}
              {evalStatus === "rerecording" && (
                /* 重读录音操作区（US2）：覆盖先前视图，取消回 ready */
                <RerecordBox
                  refText={rawText}
                  onRecorded={handleRerecorded}
                  onCancel={() => setEvalStatus("ready")}
                />
              )}
              {evalStatus === "ready" && evaluation && (
                <>
                  {/* 区块一：发音逐词分析（FR-002，美音单路） */}
                  <PronunciationSection
                    messageId={messageId}
                    rawText={rawText}
                    corrections={corrections}
                    words={evaluation.words}
                    showHint={showHint}
                  />
                  {/* 区块二：评分建议（FR-003）+ 重读入口（US2） */}
                  <ScoreAdviceSection
                    result={evaluation}
                    onRerecord={() => setEvalStatus("rerecording")}
                  />
                </>
              )}
            </div>
          )}

          {/* ===== 语境润色区块（006 链路原样；correction 模式降为第三区块小标题） ===== */}
          {mode === "correction" && (
            <div className="mt-4 border-t border-black/10 pt-3">
              <h4 className="text-muted-foreground text-xs">语境润色</h4>
            </div>
          )}

          {/* 风格标签栏（FR-008，验收调整后单项）：地道美式高亮 */}
          <div className="mt-3 flex items-center gap-2">
            {STYLE_TABS.map((tab) => (
              <button
                key={tab}
                type="button"
                className={cn(
                  "cursor-pointer rounded-full px-3 py-1 text-xs transition-colors",
                  tab === ACTIVE_STYLE
                    ? "bg-foreground text-background font-medium"
                    : "text-muted-foreground hover:bg-black/5",
                )}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* 内容区：即时路径恒 ready；按需路径走状态机（FR-004/FR-005/FR-006） */}
          {mode === "correction" && demandStatus === "loading" && (
            <div className="mt-4 py-6 text-center">
              <p className="text-muted-foreground flex items-center justify-center gap-1.5 text-sm">
                <span className="inline-block size-1.5 animate-pulse rounded-full bg-current" />
                润色生成中…
              </p>
            </div>
          )}
          {mode === "correction" && demandStatus === "failed" && (
            <div className="mt-4 py-6 text-center">
              <button
                type="button"
                onClick={requestPolish}
                className="text-muted-foreground hover:text-foreground cursor-pointer text-sm"
              >
                润色获取失败，请重试
              </button>
            </div>
          )}

          {contentReady && (
            <>
              {/* 优化后的句子（FR-003） */}
              <div className="mt-3.5">
                <p className="text-muted-foreground text-xs">优化后的句子</p>
                <p className="mt-1 text-base leading-relaxed font-medium wrap-break-word">
                  {activePolished}
                </p>
              </div>

              {/* 修改解释（FR-003；空解释不占位，fallback 场景解释仍由后端给出） */}
              {activeExplanation.trim() && (
                <div className="mt-3">
                  <p className="text-muted-foreground text-xs">修改解释</p>
                  <p className="mt-1 text-sm leading-relaxed wrap-break-word">
                    {activeExplanation}
                  </p>
                </div>
              )}

              {/* 操作行（FR-009）：四件套全部作用于润色句 */}
              <div className="mt-4 flex items-center gap-4 border-t border-black/10 pt-2.5 text-sm">
                <button
                  type="button"
                  onClick={() =>
                    openFollowAlong(messageId, activePolished, activeContext, activeAsCorrection)
                  }
                  aria-label="循环跟读"
                  className="flex cursor-pointer items-center gap-1 rounded-md px-0.5 py-0.5 transition-colors hover:bg-black/5"
                >
                  <Mic className="size-4" aria-hidden />
                  循环跟读
                </button>
                <button
                  type="button"
                  onClick={() => void handleCopy()}
                  disabled={!activePolished}
                  aria-label="复制润色后的句子"
                  className="flex cursor-pointer items-center gap-1 rounded-md px-0.5 py-0.5 transition-colors hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {copied ? (
                    <Check className="size-4 text-green-600" aria-hidden />
                  ) : (
                    <Copy className="size-4" aria-hidden />
                  )}
                  复制
                </button>
                <button
                  type="button"
                  onClick={() => showHint("功能开发中")}
                  aria-label="收藏"
                  className="flex cursor-pointer items-center gap-1 rounded-md px-0.5 py-0.5 transition-colors hover:bg-black/5"
                >
                  <Star className="size-4" aria-hidden />
                  收藏
                </button>
                {mode === "polisher" ? (
                  <button
                    type="button"
                    onClick={() => void tts.handlePlay()}
                    disabled={tts.loading}
                    aria-label="播放润色后句子发音"
                    className="ml-auto flex cursor-pointer items-center gap-0.5 rounded-md px-0.5 py-0.5 transition-colors hover:bg-black/5 disabled:opacity-50"
                  >
                    AI
                    {tts.loading ? (
                      <span
                        className="size-3.5 animate-pulse rounded-full bg-current"
                        aria-hidden
                      />
                    ) : (
                      <Volume2
                        className={cn("size-4", tts.status === "playing" && "text-green-600")}
                        aria-hidden
                      />
                    )}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void handlePanelPlay()}
                    disabled={panelAudioLoading}
                    aria-label="播放润色后句子发音"
                    className="ml-auto flex cursor-pointer items-center gap-0.5 rounded-md px-0.5 py-0.5 transition-colors hover:bg-black/5 disabled:opacity-50"
                  >
                    AI
                    {panelAudioLoading ? (
                      <span
                        className="size-3.5 animate-pulse rounded-full bg-current"
                        aria-hidden
                      />
                    ) : (
                      <Volume2
                        className={cn("size-4", panelAudioStatus === "playing" && "text-green-600")}
                        aria-hidden
                      />
                    )}
                  </button>
                )}
              </div>
            </>
          )}

          {hint && <p className="text-muted-foreground mt-2 text-xs">{hint}</p>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
