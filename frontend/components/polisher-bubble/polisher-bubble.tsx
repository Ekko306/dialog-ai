"use client";

import { useAuiState } from "@assistant-ui/react";
import { useLangChainState } from "@assistant-ui/react-langchain";
import { useState } from "react";
import { PolisherToolbar } from "@/components/polisher-bubble/polisher-toolbar";
import { PolisherActions } from "@/components/polisher-bubble/polisher-actions";
import { PolisherScoreBar } from "@/components/polisher-bubble/polisher-score-bar";
import { IdiomPanel } from "@/components/idiom-panel/idiom-panel";
import { useTranslation } from "@/components/correction-bubble/use-translation";
import type { CorrectionInput } from "@/lib/tts-client";
import {
  parsePolisherData,
  shouldRenderPolisher,
  getCachedPolisher,
  setCachedPolisher,
  type PolisherMessageData,
} from "@/components/polisher-bubble/polisher-data";
import { AssistantMessage as DefaultAssistantMessage } from "@/components/thread.aui";

/**
 * 润色气泡（005 US1 T005，FR-001/FR-002/FR-004；布局基准
 * frontend/docs/mockups/子功能-对话演示气泡-拓展润色场景.jpg）：
 * 展开态=原句行 + 功能行 + 译文区（按需）+ You can also say 建议行 + 操作栏（默认展开）；
 * 收起态=紧凑两行（原句行 + 功能行，箭头向下，R5 与 003 收起模式对齐）。
 * 音频/翻译全部走旁路复用（R1 伪条目 / FR-006），气泡本体无独立网络请求。
 */

interface PolisherBubbleProps {
  data: PolisherMessageData;
  messageId: string;
}

export function PolisherBubble({ data, messageId }: PolisherBubbleProps) {
  const [expanded, setExpanded] = useState(true);
  const [translationOpen, setTranslationOpen] = useState(false);
  // 006 US1（T005）：语境润色弹窗开合状态由本气泡自持（R4，组件卸载自动关闭）
  const [idiomOpen, setIdiomOpen] = useState(false);
  const translation = useTranslation(messageId, data.raw_text);
  // R1 润色伪条目：走 003 TTS 旁路，correct kind 音频即润色句（仅前端内存构造）
  const polishAsCorrection: CorrectionInput[] = [
    { wrong: data.raw_text, correct: data.polished_text, type: "polish" },
  ];

  const handleToggleTranslation = () => {
    const next = !translationOpen;
    setTranslationOpen(next);
    // 展开时按需获取：缓存命中即时显示，未命中发起翻译旁路请求（004 行为继承）
    if (next) translation.open();
  };

  return (
    <div data-slot="aui_polisher-bubble">
      <div className="bg-(--bubble-ai) text-foreground rounded-xl px-4 py-3 leading-relaxed wrap-break-word">
        {/* 原句行（收起态保留，FR-002；无片段级高亮——契约无错误片段数据，spec Assumptions） */}
        <p className="text-base font-medium">{data.raw_text}</p>

        {/* 功能行（双态都保留，FR-003） */}
        <PolisherToolbar
          messageId={messageId}
          rawText={data.raw_text}
          polishAsCorrection={polishAsCorrection}
          expanded={expanded}
          onToggle={() => setExpanded((e) => !e)}
          translationOpen={translationOpen}
          onToggleTranslation={handleToggleTranslation}
        />

        {expanded && (
          <>
            {/* 译文区（FR-006）：功能行正下方、建议行上方，上下虚线分隔（004 布局继承） */}
            {translationOpen && (
              <div className="mt-2.5 border-y border-dashed border-black/10 py-2.5">
                {!data.raw_text.trim() ? (
                  /* 空原句：不可用终态，不提供重试（004 Edge Case 继承） */
                  <p className="text-muted-foreground text-sm">原句为空，无法翻译</p>
                ) : (
                  <>
                    {translation.status === "loading" && (
                      <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
                        <span className="inline-block size-1.5 animate-pulse rounded-full bg-current" />
                        翻译中…
                      </p>
                    )}
                    {translation.status === "success" && (
                      <p className="text-sm wrap-break-word">{translation.text}</p>
                    )}
                    {translation.status === "failed" && (
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

            {/* 润色建议行（FR-004）：前缀为界面固定文案（非 AI 产出），位于操作栏之上 */}
            <p className="mt-2.5 border-t border-dashed border-black/10 pt-2.5 text-sm">
              You can also say: <span className="font-medium">&ldquo;{data.polished_text}&rdquo;</span>
            </p>

            {/* 操作栏（FR-005，作用于润色句） */}
            <PolisherActions
              messageId={messageId}
              rawText={data.raw_text}
              polishedText={data.polished_text}
              polishAsCorrection={polishAsCorrection}
            />
          </>
        )}
      </div>

      {/* 评分条（FR-007，analyze C2 决议：恒显语法正确项，发音项无数据源不渲染） */}
      <PolisherScoreBar onIdiomOpen={() => setIdiomOpen(true)} />
      {/* 006 US1：即时数据路径（FR-004）——润色结果已随消息透传，面板无加载态 */}
      <IdiomPanel
        open={idiomOpen}
        onClose={() => setIdiomOpen(false)}
        messageId={messageId}
        mode="polisher"
        polishedText={data.polished_text}
        explanation={data.explanation}
        contextRawText={data.raw_text}
      />
    </div>
  );
}

/** 从 assistant-ui 消息 content（字符串或 content parts 数组）提取纯文本（003 同款私有副本） */
function extractMessageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part && typeof part === "object" && part.type === "text" && typeof (part as { text?: unknown }).text === "string"
          ? (part as { text: string }).text
          : "",
      )
      .join("");
  }
  return "";
}

/**
 * 润色分流组件（005 T007，research R2/R3）：由 003 CorrectionAwareAssistantMessage
 * 在纠错未命中时接管（纠错 → 润色 → 普通 三级分流优先级）。
 *
 * 读取路径两条（contract §2）：
 * 1. metadata.custom.polisher_data 直读——仅非流式/历史回灌生效（流式下 SDK
 *    assembledToBaseMessage 丢弃 additional_kwargs，003 实测教训）；
 * 2. LangGraph 顶层 state 字段关联（流式主路径）——values 事件原样保留 polisher
 *    字典，消息级关联用「正文包含润色句」：润色正文是多行拼接（「当前语句没有
 *    错误」+「润色建议：…」+解释），不可全等匹配；包含匹配同时防历史消息误挂
 *    最新润色（旧润色句不会出现在后续消息正文里）。
 * fallback/skipped 场景正文不含润色句 → 路径 2 天然不命中，metadata 数据由
 * shouldRenderPolisher 守卫拦截（FR-009），降级为普通消息渲染。
 */
export function PolisherAwareAssistantMessage() {
  const messageId = useAuiState((s) => s.message.id) ?? "";
  const messageText = useAuiState((s) => extractMessageText(s.message.content)).trim();

  const polisherMeta = useAuiState((s) => {
    const custom = s.message.metadata?.custom as Record<string, unknown> | undefined;
    return custom?.polisher_data;
  });

  const statePolisher = useLangChainState<Record<string, unknown> | null>("polisher", null);

  let data = parsePolisherData(polisherMeta);
  if (!data && messageText && statePolisher) {
    const fromState = parsePolisherData(statePolisher);
    if (
      fromState &&
      fromState.polished_text.trim() &&
      messageText.includes(fromState.polished_text.trim())
    ) {
      data = fromState;
    }
  }

  if (data && messageId) setCachedPolisher(messageId, data);
  else if (messageId) data = getCachedPolisher(messageId) ?? null;

  if (data && shouldRenderPolisher(data)) {
    return <PolisherBubble data={data} messageId={messageId} />;
  }
  return <DefaultAssistantMessage />;
}
