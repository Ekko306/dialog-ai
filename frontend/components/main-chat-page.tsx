import { Camera, MessageCircleMore, SlidersHorizontal, Volume2 } from "lucide-react";
import { useState } from "react";
import { CorrectionAwareAssistantMessage } from "@/components/correction-bubble/correction-bubble";
import { FollowAlongPanel } from "@/components/follow-along-panel/follow-along-panel";
import { InterruptPrompt } from "@/components/interrupt-prompt";
import { PolisherTtsAutoResponder } from "@/components/polisher-tts-auto-responder";
import { SceneSelectPopup } from "@/components/scene-select/scene-select-popup";
import { SceneApplier } from "@/components/scene-select/scene-applier";
import { SceneApplyToast } from "@/components/scene-select/scene-apply-toast";
import { Thread } from "@/components/thread.aui";
import { AutoContinue, NewDialogButton } from "@/components/talk-flow";

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
 */
export function MainChatPage() {
  const [scenePopupOpen, setScenePopupOpen] = useState(false);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="grid h-12 shrink-0 grid-cols-[1fr_auto_1fr] items-center border-b bg-background px-4">
        <MessageCircleMore className="text-foreground size-5 justify-self-start" aria-hidden />
        <div className="flex items-center gap-2">
          <div
            className="bg-primary/15 text-primary flex size-8 items-center justify-center rounded-full text-sm font-semibold"
            aria-hidden
          >
            E
          </div>
          <span className="text-base font-semibold">Ella</span>
        </div>
        <div className="flex items-center gap-3 justify-self-end" aria-hidden>
          <Volume2 className="text-(--icon-brand-green) size-5" />
          <SlidersHorizontal className="text-foreground size-5" />
        </div>
      </header>
      <div className="relative min-h-0 flex-1">
        {/* 003 T009：AI 消息渲染经官方 AssistantMessage 扩展点分流——
            含 correction_data 的消息渲染纠错气泡，其余走原分支零回归 */}
        <Thread components={{ AssistantMessage: CorrectionAwareAssistantMessage }} />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col gap-4 px-4 pb-4 md:pb-6">
          <div className="pointer-events-auto mx-auto flex w-full max-w-[44rem] flex-col gap-3">
            <div className="flex items-center justify-center gap-3">
              <NewDialogButton />
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
      {/* 003 US4：循环跟读面板（页面级底部滑入，经 zustand store 由操作栏唤起） */}
      <FollowAlongPanel />
      <SceneApplier />
      {/* 润色语音询问自动应答（无错句子跳过 yes/no 询问，直接合成语音） */}
      <PolisherTtsAutoResponder />
      <SceneApplyToast />
    </div>
  );
}
