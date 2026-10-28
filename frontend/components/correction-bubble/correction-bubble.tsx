"use client";

import { useAuiState } from "@assistant-ui/react";
import { useLangChainState } from "@assistant-ui/react-langchain";
import { useState } from "react";
import { cn } from "cn";
import { CorrectionToolbar } from "@/components/correction-bubble/correction-toolbar";
import { CorrectionActions } from "@/components/correction-bubble/correction-actions";
import { ScoreBar } from "@/components/correction-bubble/score-bar";
import { useTranslation } from "@/components/correction-bubble/use-translation";
import { IdiomPanel } from "@/components/idiom-panel/idiom-panel";
import { PolisherAwareAssistantMessage } from "@/components/polisher-bubble/polisher-bubble";

/**
 * 纠错气泡（US1 T008，FR-001/FR-002；布局基准
 * frontend/docs/mockups/子功能-对话演示气泡-语法纠错场景.jpg）：
 * 展开态=原句行 + 功能行 + 讲解 + ✅ 正确句 + 操作栏（默认，clarify 决议）；
 * 收起态=紧凑两行（原句行 + 功能行，箭头向下）。
 * 翻译区（004）：功能行之下、讲解之上，上下虚线分隔（spec Assumptions 第 6 条布局），
 * 点击「文A」按需加载（use-translation 状态机：加载中/译文/失败重试/空原句不可用）。
 * 挂载分流（US1 T009）：经 Thread components.AssistantMessage 官方扩展点注入，
 * 读消息 metadata.custom.correction_data 识别（003 契约）；缺失走原渲染分支一字不动。
 */

export interface CorrectionItem {
  wrong: string;
  correct: string;
  type: string;
}

/** 003 契约：后端 additional_kwargs["metadata"]["correction_data"] 透传结构 */
export interface CorrectionMessageData {
  raw_text: string;
  tutor_reply: string;
  corrections: CorrectionItem[];
  ise_grade: number | null;
  feedback: string | null;
}

/**
 * 字段容错守卫（FR-001：缺失/反序列化失败一律走普通气泡，不报错）。
 * raw_text 与 tutor_reply 是渲染必需；其余字段允许缺省。
 */
export function parseCorrectionData(value: unknown): CorrectionMessageData | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.raw_text !== "string" || typeof v.tutor_reply !== "string") return null;
  const corrections = Array.isArray(v.corrections)
    ? v.corrections.filter(
        (c): c is CorrectionItem =>
          typeof c === "object" &&
          c !== null &&
          typeof (c as Record<string, unknown>).correct === "string",
      )
    : [];
  return {
    raw_text: v.raw_text,
    tutor_reply: v.tutor_reply,
    corrections,
    ise_grade: typeof v.ise_grade === "number" ? v.ise_grade : null,
    feedback: typeof v.feedback === "string" ? v.feedback : null,
  };
}

interface CorrectionBubbleProps {
  data: CorrectionMessageData;
  messageId: string;
}

export function CorrectionBubble({ data, messageId }: CorrectionBubbleProps) {
  const [expanded, setExpanded] = useState(true);
  const [translationOpen, setTranslationOpen] = useState(false);
  // 006 US2（T007）：语境润色弹窗开合状态由本气泡自持（R4），按需润色状态机内聚在 IdiomPanel
  const [idiomOpen, setIdiomOpen] = useState(false);
  const translation = useTranslation(messageId, data.raw_text);
  const corrections = data.corrections;
  const correctText = corrections[0]?.correct;

  const handleToggleTranslation = () => {
    const next = !translationOpen;
    setTranslationOpen(next);
    // 展开时按需获取：缓存命中即时显示，未命中发起翻译旁路请求（004 R1/R3）
    if (next) translation.open();
  };

  return (
    <div data-slot="aui_correction-bubble">
      <div className="bg-(--bubble-ai) text-foreground rounded-xl px-4 py-3 leading-relaxed wrap-break-word">
        {/* 原句行（收起态保留） */}
        <p className="text-base font-medium">{data.raw_text}</p>

        {/* 功能行（双态都保留） */}
        <CorrectionToolbar
          messageId={messageId}
          rawText={data.raw_text}
          corrections={corrections}
          expanded={expanded}
          onToggle={() => setExpanded((e) => !e)}
          translationOpen={translationOpen}
          onToggleTranslation={handleToggleTranslation}
        />

        {expanded && (
          <>
            {/* 翻译区（004，spec Assumptions 第 6 条布局）：功能行之下、讲解之上，上下虚线分隔 */}
            {translationOpen && (
              <div className="mt-2.5 border-y border-dashed border-black/10 py-2.5">
                {!data.raw_text.trim() ? (
                  /* 空原句（Edge Case 2）：不可用终态，不提供重试 */
                  <p className="text-muted-foreground text-sm">原句为空，无法翻译</p>
                ) : (
                  <>
                    {translation.status === "loading" && (
                      /* 加载中（FR-002）：脉冲圆点表现，替代 003「暂无翻译」占位 */
                      <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
                        <span className="inline-block size-1.5 animate-pulse rounded-full bg-current" />
                        翻译中…
                      </p>
                    )}
                    {translation.status === "success" && (
                      /* 译文行（FR-008）：常规色纯文本，随内容自动换行 */
                      <p className="text-sm wrap-break-word">{translation.text}</p>
                    )}
                    {translation.status === "failed" && (
                      /* 失败可重试（FR-003/US2）：行内文案点击重试，无弹窗无跳转 */
                      <button
                        type="button"
                        onClick={translation.retry}
                        className="text-muted-foreground hover:text-foreground cursor-pointer text-left text-sm"
                      >
                        翻译获取失败，请重试
                      </button>
                    )}
                  </>
                )}
              </div>
            )}

            {/* 讲解区：tutor_reply 原样渲染（保留换行与编号格式）。
                功能行与纠错内容之间的虚线：翻译区开启时由翻译区自身 border-y 分隔，
                关闭时由本区块顶部虚线补位，保证任意状态下恰好一条 */}
            <div
              className={cn(
                "text-sm whitespace-pre-wrap",
                !translationOpen && "mt-2.5 border-t border-dashed border-black/10 pt-2.5",
              )}
            >
              {data.tutor_reply}
            </div>

            {/* 短虚线分隔：纠错讲解 ↔ ✅ 正确句 */}
            {correctText && <div className="mt-2.5 w-14 border-t border-dashed border-black/25" />}

            {/* ✅ 正确句行：取第一条修正的完整修正句（清单为空不展示，Edge Case） */}
            {correctText && (
              <p className="mt-2 text-sm font-medium">
                <span className="text-green-600">✅</span> {correctText}
              </p>
            )}

            {/* 操作栏（US2/US3/US4 行为挂载点） */}
            <CorrectionActions
              messageId={messageId}
              rawText={data.raw_text}
              corrections={corrections}
            />
          </>
        )}
      </div>

      {/* 评分条（US6，气泡下方独立小条）；地道/发音入口均在有纠正句时开放
          （007 FR-001：两入口共用一个完整三区块面板） */}
      <ScoreBar
        data={data}
        onIdiomOpen={correctText ? () => setIdiomOpen(true) : undefined}
        onPronunciationOpen={correctText ? () => setIdiomOpen(true) : undefined}
      />
      {/* 006 US2 / 007：按需数据路径——纠错模式传 rawText + corrections 启用评测区 */}
      {correctText && (
        <IdiomPanel
          open={idiomOpen}
          onClose={() => setIdiomOpen(false)}
          messageId={messageId}
          mode="correction"
          correctedSentence={correctText}
          rawText={data.raw_text}
          corrections={corrections}
        />
      )}
    </div>
  );
}

/**
 * 会话级缓存：值关联只覆盖"最新一轮"纠错（LangGraph 顶层 state 是线程级单值），
 * 缓存让历史气泡在本次会话内持续展示；刷新后随新线程自然失效。
 */
const correctionCache = new Map<string, CorrectionMessageData>();

/** 从 assistant-ui 消息 content（字符串或 content parts 数组）提取纯文本 */
function extractMessageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part &&
        typeof part === "object" &&
        part.type === "text" &&
        typeof (part as { text?: unknown }).text === "string"
          ? (part as { text: string }).text
          : "",
      )
      .join("");
  }
  return "";
}

/**
 * Thread 的 AssistantMessage 覆盖组件（US1 T009 挂载分流）：
 * 有纠错数据 → 纠错气泡；无/守卫失败 → 005 润色分流（PolisherAwareAssistantMessage，
 * 内部兜底回既有渲染分支）；三级优先级：纠错 → 润色 → 普通（005 research R3）。
 *
 * 读取路径两条：
 * 1. metadata.custom.correction_data（003 契约原路径）——流式链路下
 *    @langchain/langgraph-sdk 组装消息时会丢弃 additional_kwargs（SDK
 *    assembledToBaseMessage 仅保留 usage，且 values 回声因 content 表示
 *    不一致无法覆盖），该路径仅在非流式/历史回灌场景生效，保留兼容；
 * 2. LangGraph 顶层 state 字段关联（流式主路径）——values 事件原样保留
 *    tutor_reply/raw_text/corrections 等字段，tutor_reply 与消息正文同源，
 *    用正文匹配做消息级关联，避免历史消息误挂最新纠错。
 */
export function CorrectionAwareAssistantMessage() {
  const messageId = useAuiState((s) => s.message.id) ?? "";
  const messageText = useAuiState((s) => extractMessageText(s.message.content)).trim();

  const correctionData = useAuiState((s) => {
    const custom = s.message.metadata?.custom as Record<string, unknown> | undefined;
    return custom?.correction_data;
  });

  const stateTutorReply = useLangChainState<string>("tutor_reply", "");
  const stateRawText = useLangChainState<string>("raw_text", "");
  const stateCorrections = useLangChainState<CorrectionItem[]>("corrections", []);
  const stateIseGrade = useLangChainState<number | null>("ise_grade", null);
  const stateFeedback = useLangChainState<string | null>("feedback", null);

  let data = parseCorrectionData(correctionData);
  if (
    !data &&
    messageText &&
    stateCorrections.length > 0 &&
    messageText === stateTutorReply.trim()
  ) {
    data = parseCorrectionData({
      raw_text: stateRawText,
      tutor_reply: stateTutorReply,
      corrections: stateCorrections,
      ise_grade: stateIseGrade,
      feedback: stateFeedback,
    });
  }

  if (data && messageId) correctionCache.set(messageId, data);
  else if (messageId) data = correctionCache.get(messageId) ?? null;

  if (data) return <CorrectionBubble data={data} messageId={messageId} />;
  // 005 分流：纠错未命中 → 润色判定（润色未命中在 PolisherAwareAssistantMessage 内兜底普通渲染）
  return <PolisherAwareAssistantMessage />;
}
