import { useLangChainStream } from "@assistant-ui/react-langchain";
import { Camera, MessageCircleMore, SlidersHorizontal, Volume2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { InterruptPrompt } from "@/components/interrupt-prompt";
import { AssistantSuggestions } from "@/components/recommended-replies.aui";
import { SceneSelectPopup } from "@/components/scene-select/scene-select-popup";
import { SceneApplier } from "@/components/scene-select/scene-applier";
import { SceneApplyToast } from "@/components/scene-select/scene-apply-toast";
import { Thread } from "@/components/thread.aui";
import { AutoContinue, NewDialogButton } from "@/components/talk-flow";
import { ensureBackendPersona, MAIN_DEFAULT_PERSONA } from "@/lib/backend-persona";
import { getRole, MAIN_ROLE_ID } from "@/lib/role-catalog";
import { useRoleThreadStore } from "@/lib/role-thread-store";

/**
 * Tab1 主页面（US3 T022 按原型图补全样式）：
 * - 顶部栏：左会话入口图标、居中头像 + "Ella"、右音频/设置图标；
 *   无子功能支撑的图标按 FR-010 静态展示（非按钮，点击无行为不报错）
 * - 嵌入 thread.aui.tsx（消息流，行为不改）
 * - NewDialogButton / AutoContinue / InterruptPrompt（US2 迁入，行为不改；
 *   research R7：interrupt 恢复必须走 respond 路径）
 * - 底部常驻区域 absolute 定位，等效原 ViewportFooter sticky bottom-0 的吸附位置；
 *   max-w 与 thread.aui.tsx Root 的 --thread-max-width 保持一致（44rem）；
 *   "新会话 / 选场景"按钮区按原型图置于输入条上方（NewDialogButton 视觉整合，
 *   "选场景"按钮唤起底部弹窗，002 FR-001）
 * - SceneApplier / SceneApplyToast：场景指令发送与失败提示（002 FR-006/FR-013）
 * - 003：左上角消息入口按钮（FR-001，onOpenMessages 由 Shell 分发）；
 *   Alicia 主线程元数据快照接线 —— 挂载 enterRole（角标清零，FR-004）、
 *   卸载 leaveRole 快照（最后一条消息截 60 字符 + isRunning → 未读标记，
 *   research R4 规则表，quickstart 1.4/1.5 依赖）
 */

/** 提取消息文本用于预览快照：兼容 string 与 blocks 数组两种 content 形态
 *  （仅本模块 lastPreviewText 消费；role-chat-page 复用的是 lastPreviewText） */
function messagePreviewText(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === "string") return block;
        if (
          block &&
          typeof block === "object" &&
          typeof (block as { text?: unknown }).text === "string"
        ) {
          return (block as { text: string }).text;
        }
        return "";
      })
      .join("");
  }
  return "";
}

/**
 * 外显预览取值：从后往前取第一条能提取出非空文本的消息（003 T018 排障结论）。
 * 不能直接取最后一条——后端图每轮收尾都会写 SystemMessage("") 作气泡分隔符
 * （talk_graph.py 的 tutor_reply_message_node / polisher_reply_message_node /
 * coach_reply_subgraph），完整对话轮结束后 messages 的最后一条恒为空系统消息，
 * 直接取值会把 lastPreview 写成空串 → 消息页回落开场白
 * （2026-10-27 用户实测：Ella 完整对话后外显仍显示开场白的根因）。
 */
export function lastPreviewText(messages: readonly unknown[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const text = messagePreviewText(messages[i]).trim();
    if (text) return text;
  }
  return "";
}

export function MainChatPage({ onOpenMessages }: { onOpenMessages: () => void }) {
  const [scenePopupOpen, setScenePopupOpen] = useState(false);
  const stream = useLangChainStream();
  const enterRole = useRoleThreadStore((s) => s.enterRole);
  const leaveRole = useRoleThreadStore((s) => s.leaveRole);
  // latest-ref：卸载回调里读取 stream 的最终状态（消息/isLoading/threadId）
  const streamRef = useRef(stream);
  streamRef.current = stream;
  // 最近一次非空消息快照：线程历史是异步 join 的，若用户在加载完成前离开，
  // stream.messages 此刻为空——直接取值会把 lastPreview 写成空串、覆盖掉已有外显
  // （2026-10-27 实测：Edge 反复"时间戳更新但预览回落开场白"）。因此挂载期间持续
  // 记住最近一次非空消息列表，离开时用它兜底；真·空线程（从未对话）仍正确写空。
  const lastMessagesRef = useRef<readonly unknown[]>([]);
  const currentMessages = (stream?.messages ?? []) as readonly unknown[];
  if (currentMessages.length > 0) {
    lastMessagesRef.current = currentMessages;
  }

  useEffect(() => {
    enterRole(MAIN_ROLE_ID);
    return () => {
      const s = streamRef.current;
      const messages = lastMessagesRef.current;
      leaveRole({
        roleId: MAIN_ROLE_ID,
        threadId: s?.threadId ?? null,
        lastPreview: lastPreviewText(messages),
        hasNewActivity: Boolean(s?.isLoading),
      });
    };
  }, [enterRole, leaveRole]);

  // 顶栏头像（MAIN_ROLE_ID）：提取变量以便类型收窄（union 判别不能跨两次函数调用）
  const mainAvatar = getRole(MAIN_ROLE_ID)?.avatar;

  // 人设防串台（backend-persona.ts）：后端教练人设是全局单例 Store，角色页挂载会
  // 覆盖它——主对话页挂载时回写主人设（用户上次选场景，缺省 英语口语教练/日常闲聊），
  // 保证本页后续新话题（AutoContinue/新会话）不被角色页人设污染
  const lastMainPersona = useRoleThreadStore((s) => s.lastMainPersona);
  const mainPersona = lastMainPersona ?? MAIN_DEFAULT_PERSONA;
  useEffect(() => {
    const apiUrl =
      process.env.NEXT_PUBLIC_LANGGRAPH_API_URL ||
      (typeof window !== "undefined" ? new URL("/api", window.location.href).href : undefined);
    if (!apiUrl) return;
    void ensureBackendPersona(apiUrl, mainPersona);
  }, [mainPersona]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="grid h-12 shrink-0 grid-cols-[1fr_auto_1fr] items-center border-b bg-background px-4">
        <button
          type="button"
          onClick={onOpenMessages}
          aria-label="消息"
          className="text-foreground -m-1 cursor-pointer justify-self-start rounded-md p-1 transition-colors hover:bg-accent"
        >
          <MessageCircleMore className="size-5" aria-hidden />
        </button>
        <div className="flex items-center gap-2">
          {/* 顶栏头像接角色目录（MAIN_ROLE_ID）；initial 兜底仅防御目录数据异常 */}
          {mainAvatar?.kind === "image" ? (
            <img
              src={mainAvatar.src}
              alt=""
              aria-hidden
              className="size-8 shrink-0 rounded-full object-cover"
            />
          ) : (
            <div
              className="bg-primary/15 text-primary flex size-8 items-center justify-center rounded-full text-sm font-semibold"
              aria-hidden
            >
              E
            </div>
          )}
          <span className="text-base font-semibold">Ella</span>
        </div>
        <div className="flex items-center gap-3 justify-self-end" aria-hidden>
          <Volume2 className="text-(--icon-brand-green) size-5" />
          <SlidersHorizontal className="text-foreground size-5" />
        </div>
      </header>
      <div className="relative min-h-0 flex-1">
        <Thread components={{ AssistantSuggestions }} />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col gap-4 px-4 pb-4 md:pb-6">
          <div className="pointer-events-auto mx-auto flex w-full max-w-[44rem] flex-col gap-3">
            <div className="flex items-center justify-center gap-3">
              <NewDialogButton persona={mainPersona} />
              <button
                type="button"
                onClick={() => setScenePopupOpen(true)}
                aria-label="选场景"
                className="bg-background text-foreground flex cursor-pointer items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium shadow-sm transition-colors hover:bg-accent"
              >
                <Camera className="size-4" aria-hidden />
                选场景
              </button>
            </div>
            <InterruptPrompt />
            <AutoContinue />
          </div>
        </div>
        <SceneSelectPopup open={scenePopupOpen} onOpenChange={setScenePopupOpen} />
      </div>
      <SceneApplier />
      <SceneApplyToast />
    </div>
  );
}
