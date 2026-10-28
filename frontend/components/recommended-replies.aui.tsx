"use client";

import { ThreadPrimitive } from "@assistant-ui/react";
import {
  useLangChainInterruptState,
  useLangChainState,
  useLangChainStream,
} from "@assistant-ui/react-langchain";

/**
 * 推荐回复渲染器（003 T014，契约：specs/003-switch-conversation-role/contracts/recommended-replies.md §2.3）：
 * 一个文件两个导出 —— ① RecommendedReplies 共用渲染器（来源 A 角色配置 / 来源 B 后端 state）；
 * ② AssistantSuggestions 来源 B 读取组件（后端 state key `suggestions`，本期后端零改动，
 * 读取恒为空 → 不渲染任何占位，FR-010 降级无痕）。
 *
 * 渲染规则：白底圆角胶囊行 + "标签: 文案"前缀（对照图1/图3），单行截断、多 chips 纵向堆叠；
 * 点击 = ThreadPrimitive.Suggestion send → text 作为用户消息发送（FR-009，label 不入正文），
 * 走 submit 通道与 HITL respond 通道互斥 → run 进行中或存在挂起 interrupt 时整组隐藏。
 * 隐藏判定沿用 talk-flow/interrupt-prompt 的既有 hook 语义（stream.isLoading / interrupt），
 * 未用 AuiIf（AssistantState 中 interrupt 形态未验证，hook 路径为已验证的同义实现）。
 */

export interface RecommendedReply {
  label: string;
  text: string;
}

export function RecommendedReplies({ replies }: { replies: readonly RecommendedReply[] }) {
  const stream = useLangChainStream();
  const interrupt = useLangChainInterruptState();

  const visible = replies.length > 0 && !stream?.isLoading && !interrupt;
  if (!visible) return null;

  return (
    <div className="flex w-full flex-col gap-1.5">
      {replies.map((reply) => (
        <ThreadPrimitive.Suggestion
          key={`${reply.label}:${reply.text}`}
          prompt={reply.text}
          send
          render={
            <button
              type="button"
              className="bg-background hover:bg-accent text-foreground flex w-full cursor-pointer items-baseline gap-1.5 rounded-full px-3.5 py-1.5 text-start text-sm shadow-sm transition-colors"
            />
          }
        >
          <span className="shrink-0 font-medium">{reply.label}:</span>
          <span className="text-muted-foreground min-w-0 flex-1 truncate">{reply.text}</span>
        </ThreadPrimitive.Suggestion>
      ))}
    </div>
  );
}

/** 来源 B：读取后端 state key `suggestions`（contracts §2.1），非空时渲染 chips（contracts §3：主/角色页通用） */
export function AssistantSuggestions() {
  const replies = useLangChainState<RecommendedReply[]>("suggestions", []);
  return <RecommendedReplies replies={replies} />;
}
