"use client";

import { UserMessageAttachments } from "@/components/attachment.aui";
import { File } from "@/components/file";
import { ThreadFollowupSuggestions } from "@/components/follow-up-suggestions.aui";
import { Image } from "@/components/image";
import { MarkdownText } from "@/components/markdown-text";
import {
  Reasoning,
  ReasoningContent,
  ReasoningRoot,
  ReasoningText,
  ReasoningTrigger,
} from "@/components/reasoning.aui";
import { ToolFallback } from "@/components/tool-fallback.aui";
import { ToolGroupContent, ToolGroupRoot, ToolGroupTrigger } from "@/components/tool-group.aui";
import { TooltipIconButton } from "@/components/tooltip-icon-button";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  ActionBarMorePrimitive,
  ActionBarPrimitive,
  AuiIf,
  type AssistantState,
  BranchPickerPrimitive,
  ComposerPrimitive,
  ErrorPrimitive,
  groupPartByType,
  MessagePrimitive,
  SuggestionPrimitive,
  ThreadPrimitive,
  type FileMessagePartComponent,
  type ImageMessagePartComponent,
  type TextMessagePartComponent,
  type ToolCallMessagePartComponent,
  useAuiState,
} from "@assistant-ui/react";
import {
  ArrowDownIcon,
  AudioLinesIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  DownloadIcon,
  LoaderCircleIcon,
  MicIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PhoneIcon,
  RefreshCwIcon,
  SparklesIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
  Volume2Icon,
} from "lucide-react";
import {
  PronunciationPopup,
  type PopupSection,
} from "@/components/pronunciation-popup/pronunciation-popup";
import { ttsSourceKey, usePopupAudio } from "@/components/pronunciation-popup/use-popup-audio";
import { getSettings } from "@/lib/profile-settings";
import {
  createContext,
  useContext,
  useState,
  type ComponentType,
  type FC,
  type PropsWithChildren,
} from "react";

export type ThreadGroupPart = MessagePrimitive.GroupedParts.GroupPart;

/**
 * Optional component overrides for the thread. `AssistantMessage` and
 * `Welcome` replace whole sections; the remaining slots override how the
 * assistant message renders tool calls and part groups. Tool UIs registered
 * by name (toolkit `render`, `useAssistantDataUI`) take precedence over
 * `ToolFallback`. When `TaskGroup` is set, tool calls that carry a nested
 * conversation and have no registered UI render through it instead of the
 * tool group; without it they render like any other tool call.
 */
export type ThreadComponents = {
  AssistantMessage?: ComponentType | undefined;
  Welcome?: ComponentType | undefined;
  ToolFallback?: ToolCallMessagePartComponent | undefined;
  ToolGroup?: ComponentType<PropsWithChildren<{ group: ThreadGroupPart }>> | undefined;
  ReasoningGroup?: ComponentType<PropsWithChildren<{ group: ThreadGroupPart }>> | undefined;
  TaskGroup?: ComponentType<{ group: ThreadGroupPart }> | undefined;
};

const messageGroupBy = groupPartByType({
  reasoning: ["group-chainOfThought", "group-reasoning"],
  "tool-call": ["group-chainOfThought", "group-tool"],
  "standalone-tool-call": [],
});

type ThreadGroupKey = "group-chainOfThought" | "group-reasoning" | "group-tool" | "group-task";

const TASK_GROUP_PATH: readonly ThreadGroupKey[] = ["group-chainOfThought", "group-task"];

const taskAwareGroupBy = (
  part: Parameters<typeof messageGroupBy>[0],
  context?: Parameters<typeof messageGroupBy>[1],
): readonly ThreadGroupKey[] => {
  const path = messageGroupBy(part, context);
  return part.type === "tool-call" &&
    part.messages !== undefined &&
    path.length > 0 &&
    !context?.toolUIs?.[part.toolName]?.length
    ? TASK_GROUP_PATH
    : path;
};

export type ThreadProps = {
  components?: ThreadComponents | undefined;
};

const EMPTY_COMPONENTS: ThreadComponents = {};

const ThreadComponentsContext = createContext<ThreadComponents>(EMPTY_COMPONENTS);

// Startup exposes a loading placeholder thread; treat it as a new chat so
// the composer mounts centered. Loads after startup keep the docked layout.
const isNewChatView = (s: AssistantState) =>
  s.thread.messages.length === 0 && (!s.thread.isLoading || s.threads.isLoading);

// A switched thread that is still fetching its history: skeleton, not welcome.
const isHistoryLoadingView = (s: AssistantState) =>
  s.thread.messages.length === 0 &&
  s.thread.isLoading &&
  !s.thread.isDisabled &&
  !s.threads.isLoading;

const ThreadHistorySkeleton: FC = () => (
  <div
    data-slot="aui_thread-history-skeleton"
    role="status"
    className="animate-in fade-in fill-mode-both flex flex-col gap-y-6 [animation-delay:150ms] [animation-duration:200ms]"
  >
    <span className="sr-only">Loading conversation</span>
    <Skeleton className="ml-auto h-9 w-2/5 rounded-xl motion-reduce:animate-none" />
    <div className="flex flex-col gap-y-2">
      <Skeleton className="h-4 w-11/12 motion-reduce:animate-none" />
      <Skeleton className="h-4 w-4/5 motion-reduce:animate-none" />
      <Skeleton className="h-4 w-3/5 motion-reduce:animate-none" />
    </div>
    <Skeleton className="ml-auto h-9 w-1/3 rounded-xl motion-reduce:animate-none" />
    <div className="flex flex-col gap-y-2">
      <Skeleton className="h-4 w-10/12 motion-reduce:animate-none" />
      <Skeleton className="h-4 w-2/3 motion-reduce:animate-none" />
    </div>
  </div>
);

export const Thread: FC<ThreadProps> = ({ components = EMPTY_COMPONENTS }) => {
  const isEmpty = useAuiState(isNewChatView);

  return (
    <ThreadComponentsContext.Provider value={components}>
      <ThreadRoot isEmpty={isEmpty} />
    </ThreadComponentsContext.Provider>
  );
};

/** 主对话列最大宽度：AI/用户气泡与底部输入区共用（main-chat-page max-w 同步保持一致），
    气泡过窄会导致长文本换行局促（曾出现竖排观感），52rem 为加宽后的协调值 */
export const THREAD_MAX_WIDTH = "52rem";

const ThreadRoot: FC<{ isEmpty: boolean }> = ({ isEmpty }) => {
  const { Welcome = ThreadWelcome } = useContext(ThreadComponentsContext);

  return (
    <ThreadPrimitive.Root
      className="aui-root aui-thread-root bg-secondary @container flex h-full flex-col"
      style={{
        ["--thread-max-width" as string]: THREAD_MAX_WIDTH,
        ["--composer-bg" as string]: "var(--color-background)",
        ["--composer-radius" as string]: "1rem",
        ["--composer-padding" as string]: "8px",
      }}
    >
      <ThreadPrimitive.Viewport
        turnAnchor="top"
        data-slot="aui_thread-viewport"
        className="relative flex flex-1 flex-col overflow-x-auto overflow-y-auto scroll-smooth"
      >
        <div
          className={cn(
            "mx-auto flex w-full max-w-(--thread-max-width) flex-1 flex-col px-4 pt-4",
            isEmpty && "justify-center",
          )}
        >
          <AuiIf condition={isNewChatView}>
            <Welcome />
          </AuiIf>
          <AuiIf condition={isHistoryLoadingView}>
            <ThreadHistorySkeleton />
          </AuiIf>

          <div
            data-slot="aui_message-group"
            style={{ marginBottom: "140px" }}
            className="mb-14 flex flex-col gap-y-6 empty:hidden"
          >
            <ThreadPrimitive.Messages>{() => <ThreadMessage />}</ThreadPrimitive.Messages>
          </div>

          <ThreadPrimitive.ViewportFooter
            className={cn(
              "aui-thread-viewport-footer bg-secondary flex flex-col gap-4 overflow-visible pb-4 md:pb-6",
              !isEmpty && "sticky bottom-0 mt-auto rounded-t-(--composer-radius)",
            )}
          >
            {/* HITL 输入框（InterruptPrompt）与新会话/自动续跑已迁移至
                main-chat-page.tsx 的底部常驻区域，与 ViewportFooter 同视口位置 */}
            <ThreadScrollToBottom />
            <ThreadFollowupSuggestions />
            <AuiIf condition={(s) => isNewChatView(s) && s.composer.isEmpty}>
              <ThreadSuggestions />
            </AuiIf>
          </ThreadPrimitive.ViewportFooter>
        </div>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
};

const ThreadMessage: FC = () => {
  const { AssistantMessage: AssistantMessageComponent = AssistantMessage } =
    useContext(ThreadComponentsContext);
  const role = useAuiState((s) => s.message.role);
  const isEditing = useAuiState((s) => s.message.composer.isEditing);
  const isSpoken = useAuiState((s) => s.message.metadata.modality === "voice");

  // system 消息（T031 范式的空 SystemMessage 分隔符）仅用于切断相邻 assistant
  // 消息的气泡合并，不是对话内容：assistant-ui 官方范式（/docs/elements/message-pair）
  // 按 s.message.role 分支渲染，system 不渲染为气泡（否则空绿底容器成为空白气泡）。
  // 注：hooks 已在上方全部执行，此处 return null 符合 React 规则。
  if (role === "system") return null;
  if (isEditing) return <EditComposer />;
  if (isSpoken) return <SpokenMessage />;
  if (role === "user") return <UserMessage />;
  return <AssistantMessageComponent />;
};

type VoiceRunPosition = "single" | "start" | "middle" | "end";

const useVoiceRunPosition = (): VoiceRunPosition =>
  useAuiState((s) => {
    const before = s.thread.messages[s.message.index - 1]?.metadata.modality === "voice";
    const after = s.thread.messages[s.message.index + 1]?.metadata.modality === "voice";
    if (before) return after ? "middle" : "end";
    return after ? "start" : "single";
  });

const SpokenText: TextMessagePartComponent = ({ text }) => (
  <p className="aui-spoken-message-text m-0">{text}</p>
);

const SpokenMessage: FC = () => {
  const role = useAuiState((s) => s.message.role);
  const position = useVoiceRunPosition();
  const isSpeaking = useAuiState(
    (s) => s.message.role === "assistant" && s.message.status?.type === "running",
  );
  const opensExchange = position === "start" || position === "single";

  return (
    <MessagePrimitive.Root
      data-slot="aui_spoken-message-root"
      data-role={role}
      data-voice-run={position}
      className={cn(
        "aui-spoken-message bg-muted/40 mx-2 px-3 py-1.5 [contain-intrinsic-size:auto_48px] [content-visibility:auto]",
        position === "single" && "rounded-xl py-2",
        position === "start" && "rounded-t-xl pt-2",
        position === "middle" && "-mt-6",
        position === "end" && "-mt-6 rounded-b-xl pb-2",
      )}
    >
      {opensExchange && (
        <div
          data-slot="aui_spoken-exchange-header"
          className="text-muted-foreground mb-1.5 flex items-center gap-1.5 text-xs"
        >
          <PhoneIcon className="size-3" aria-hidden />
          <span>Voice conversation</span>
        </div>
      )}
      <div
        data-slot="aui_spoken-message-content"
        className="text-foreground flex items-start gap-2 text-sm leading-relaxed"
      >
        <span className="text-muted-foreground mt-1 shrink-0" aria-hidden>
          {role === "user" ? (
            <MicIcon className="size-3.5" />
          ) : (
            <AudioLinesIcon className="size-3.5" />
          )}
        </span>
        <span className="sr-only">{role === "user" ? "You said" : "Assistant said"}</span>
        <div className="min-w-0 flex-1 wrap-break-word">
          <MessagePrimitive.Parts components={{ Text: SpokenText }} />
          {isSpeaking && (
            <span
              data-slot="aui_spoken-message-indicator"
              role="status"
              className="text-muted-foreground ms-1 animate-pulse font-sans"
              aria-label="Assistant is speaking"
            >
              ●
            </span>
          )}
        </div>
        <SpokenActionBar />
      </div>

      {/* 003 发音弹窗入口（语音用户消息，role===user；发音/地道，原型图按钮行）。
          注：全仓库当前无代码写入 metadata.modality="voice"，本分支不可达；
          可达入口挂 UserMessage（文本用户消息）。本处保留是为了未来 voice
          元数据接通后语音气泡也有入口——两分支互斥，不会双渲染 */}
      {role === "user" && <PronunciationEntry />}
    </MessagePrimitive.Root>
  );
};

/** 发音逐词分析弹窗入口按钮行（发音 → 逐词分析锚点；地道 → 语境润色锚点） */
const PronunciationEntry: FC = () => {
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<PopupSection>("analysis");

  return (
    <>
      <div data-slot="aui_pronunciation-entry-row" className="mt-1.5 flex items-center gap-2">
        <EntryButton
          label="发音"
          onClick={() => {
            setSection("analysis");
            setOpen(true);
          }}
        >
          <Volume2Icon className="size-3" aria-hidden />
        </EntryButton>
        <EntryButton
          label="地道"
          onClick={() => {
            setSection("polish");
            setOpen(true);
          }}
        >
          <SparklesIcon className="size-3" aria-hidden />
        </EntryButton>
      </div>
      <PronunciationPopup open={open} initialSection={section} onOpenChange={setOpen} />
    </>
  );
};

const EntryButton: FC<PropsWithChildren<{ label: string; onClick: () => void }>> = ({
  label,
  onClick,
  children,
}) => (
  <button
    type="button"
    onClick={onClick}
    className="bg-background text-foreground/70 shadow-sm hover:text-foreground flex items-center gap-1 rounded-full px-2.5 py-1 text-xs transition-colors"
  >
    {children}
    {label}
  </button>
);

const SpokenActionBar: FC = () => {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="always"
      className="aui-spoken-action-bar text-muted-foreground flex shrink-0 gap-1"
    >
      <ActionBarPrimitive.Copy render={<TooltipIconButton tooltip="Copy" className="size-6" />}>
        <AuiIf condition={(s) => s.message.isCopied}>
          <CheckIcon className="animate-in zoom-in-50 fade-in duration-200 ease-out" />
        </AuiIf>
        <AuiIf condition={(s) => !s.message.isCopied}>
          <CopyIcon className="animate-in zoom-in-75 fade-in duration-150" />
        </AuiIf>
      </ActionBarPrimitive.Copy>
    </ActionBarPrimitive.Root>
  );
};

const ThreadScrollToBottom: FC = () => {
  return (
    <ThreadPrimitive.ScrollToBottom
      render={
        <TooltipIconButton
          tooltip="Scroll to bottom"
          variant="outline"
          className="aui-thread-scroll-to-bottom dark:border-border dark:bg-background dark:hover:bg-accent absolute -top-12 z-10 self-center rounded-full p-4 disabled:invisible"
        />
      }
    >
      <ArrowDownIcon />
    </ThreadPrimitive.ScrollToBottom>
  );
};

const ThreadWelcome: FC = () => {
  return (
    <div className="aui-thread-welcome-root mb-6 flex flex-col px-2">
      <p className="aui-thread-welcome-message-inner fade-in slide-in-from-bottom-1 animate-in fill-mode-both text-2xl font-medium tracking-tight duration-200">
        How can I help you today?
      </p>
    </div>
  );
};

const ThreadSuggestions: FC = () => {
  return (
    <div className="aui-thread-welcome-suggestions flex w-full flex-col">
      <ThreadPrimitive.Suggestions>{() => <ThreadSuggestionItem />}</ThreadPrimitive.Suggestions>
    </div>
  );
};

const ThreadSuggestionItem: FC = () => {
  return (
    <div className="aui-thread-welcome-suggestion-display fade-in slide-in-from-bottom-2 animate-in fill-mode-both duration-200">
      <SuggestionPrimitive.Trigger
        send
        render={
          <button
            type="button"
            className="aui-thread-welcome-suggestion group hover:bg-foreground/[0.03] focus-visible:ring-ring/50 flex w-full items-baseline gap-2.5 rounded-md px-2 py-2 text-start text-sm transition-colors outline-none focus-visible:ring-1 motion-reduce:transition-none"
          />
        }
      >
        <span
          aria-hidden
          className="text-muted-foreground/60 group-hover:text-foreground font-mono text-xs transition-colors motion-reduce:transition-none"
        >
          {">"}
        </span>
        <span className="min-w-0 flex-1 truncate">
          <SuggestionPrimitive.Title className="aui-thread-welcome-suggestion-text-1 text-foreground" />{" "}
          <SuggestionPrimitive.Description className="aui-thread-welcome-suggestion-text-2 text-muted-foreground empty:hidden" />
        </span>
      </SuggestionPrimitive.Trigger>
    </div>
  );
};

const MessageError: FC = () => {
  return (
    <MessagePrimitive.Error>
      <ErrorPrimitive.Root className="aui-message-error-root border-destructive bg-destructive/10 text-destructive dark:bg-destructive/5 mt-2 rounded-md border p-3 text-sm dark:text-red-200">
        <ErrorPrimitive.Message className="aui-message-error-message line-clamp-2" />
      </ErrorPrimitive.Root>
    </MessagePrimitive.Error>
  );
};

const AssistantMessage: FC = () => {
  const {
    ToolFallback: ToolFallbackComponent = ToolFallback,
    ToolGroup,
    ReasoningGroup,
    TaskGroup: TaskGroupComponent,
  } = useContext(ThreadComponentsContext);
  const groupBy = TaskGroupComponent ? taskAwareGroupBy : messageGroupBy;

  const ACTION_BAR_PT = "pt-1.5";
  // Keep the action bar inside the contained root's paint box, then cancel its reserved space in flow.
  const ACTION_BAR_HEIGHT = `min-h-7.5 ${ACTION_BAR_PT}`;

  return (
    <MessagePrimitive.Root
      data-slot="aui_assistant-message-root"
      data-role="assistant"
      className="fade-in slide-in-from-bottom-1 animate-in relative -mb-7.5 pb-7.5 duration-150 [contain-intrinsic-size:auto_200px] [content-visibility:auto]"
    >
      <div
        data-slot="aui_assistant-message-content"
        className="bg-(--bubble-ai) text-foreground rounded-xl px-4 py-3 leading-relaxed wrap-break-word"
      >
        <MessagePrimitive.GroupedParts groupBy={groupBy}>
          {({ part, children }) => {
            switch (part.type) {
              case "group-chainOfThought":
                return <div data-slot="aui_chain-of-thought">{children}</div>;
              case "group-task":
                return TaskGroupComponent ? <TaskGroupComponent group={part} /> : null;
              case "group-tool":
                if (ToolGroup) {
                  return <ToolGroup group={part}>{children}</ToolGroup>;
                }
                return (
                  <ToolGroupRoot variant="ghost">
                    <ToolGroupTrigger
                      count={part.indices.length}
                      active={part.status.type === "running"}
                    />
                    <ToolGroupContent>{children}</ToolGroupContent>
                  </ToolGroupRoot>
                );
              case "group-reasoning": {
                if (ReasoningGroup) {
                  return <ReasoningGroup group={part}>{children}</ReasoningGroup>;
                }
                const running = part.status.type === "running";
                return (
                  <ReasoningRoot streaming={running}>
                    <ReasoningTrigger active={running} />
                    <ReasoningContent aria-busy={running}>
                      <ReasoningText>{children}</ReasoningText>
                    </ReasoningContent>
                  </ReasoningRoot>
                );
              }
              case "text":
                return <MarkdownText />;
              case "reasoning":
                return <Reasoning {...part} />;
              case "tool-call":
                return part.toolUI ?? <ToolFallbackComponent {...part} />;
              case "data":
                return part.dataRendererUI;
              case "file":
                return (
                  <div data-slot="aui_assistant-message-file" className="py-1">
                    <File {...part} />
                  </div>
                );
              case "image":
                return (
                  <div data-slot="aui_assistant-message-image" className="py-1">
                    <Image {...part} />
                  </div>
                );
              case "indicator":
                return (
                  <span
                    data-slot="aui_assistant-message-indicator"
                    className="animate-pulse font-sans"
                    aria-label="Assistant is working"
                  >
                    {"●"}
                  </span>
                );
              default:
                return null;
            }
          }}
        </MessagePrimitive.GroupedParts>
        <MessageError />
      </div>

      <div
        data-slot="aui_assistant-message-footer"
        className={cn("ms-2 flex items-center gap-1", ACTION_BAR_HEIGHT)}
      >
        <BranchPicker />
        <SpeakMessageButton />
        <AssistantActionBar />
      </div>
    </MessagePrimitive.Root>
  );
};

/** 英文判定：拉丁字母 ≥3 且多于 CJK 字符（教练英文回复显示播放按钮，纯中文回复不显示） */
export const isMostlyEnglish = (text: string): boolean => {
  if (!text) return false;
  const latinCount = (text.match(/[A-Za-z]/g) ?? []).length;
  const cjkCount = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
  return latinCount >= 3 && latinCount > cjkCount;
};

/** AI 英文消息固定播放按钮（需求：气泡下方常驻、点击即播对应英文 TTS）。
    复用发音弹窗的模块级 TTS 单例引擎（按 (text, accent) 缓存 objectURL，重复
    点击零二次合成延迟）；口音跟随"我的"设置；播放中图标绿色高亮，再点停止。
    纯中文/无文本消息（工具调用轮）不渲染；播放不跟随 loopDefault（恒单次）。 */
export const SpeakMessageButton: FC = () => {
  const audio = usePopupAudio();
  const text = useAuiState((s) =>
    s.message.content
      .map((part) => (part.type === "text" ? part.text : ""))
      .join("\n")
      .trim(),
  );

  if (!isMostlyEnglish(text)) return null;

  const accent = getSettings().accent;
  const key = ttsSourceKey(accent, text);
  const busy = audio.activeKey === key && audio.status !== "idle";
  const loading = audio.activeKey === key && audio.status === "loading";

  return (
    <TooltipIconButton
      tooltip={busy ? "停止播放" : "播放语音"}
      onClick={() =>
        busy ? audio.stop() : audio.play({ kind: "tts", text, accent }, { loop: false })
      }
      className={cn(busy && "text-(--icon-brand-green)")}
    >
      {loading ? <LoaderCircleIcon className="animate-spin" /> : <Volume2Icon />}
    </TooltipIconButton>
  );
};

const AssistantActionBar: FC = () => {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="aui-assistant-action-bar-root text-muted-foreground animate-in fade-in col-start-3 row-start-2 -ms-1 flex gap-1 duration-200"
    >
      <ActionBarPrimitive.Copy render={<TooltipIconButton tooltip="Copy" />}>
        <AuiIf condition={(s) => s.message.isCopied}>
          <CheckIcon className="animate-in zoom-in-50 fade-in duration-200 ease-out" />
        </AuiIf>
        <AuiIf condition={(s) => !s.message.isCopied}>
          <CopyIcon className="animate-in zoom-in-75 fade-in duration-150" />
        </AuiIf>
      </ActionBarPrimitive.Copy>
      <AuiIf condition={(s) => s.thread.capabilities.feedback}>
        <ActionBarPrimitive.FeedbackPositive
          render={
            <TooltipIconButton
              tooltip="Helpful"
              className="data-[submitted=true]:bg-accent data-[submitted=true]:text-accent-foreground"
            />
          }
        >
          <ThumbsUpIcon />
        </ActionBarPrimitive.FeedbackPositive>
        <ActionBarPrimitive.FeedbackNegative
          render={
            <TooltipIconButton
              tooltip="Not helpful"
              className="data-[submitted=true]:bg-accent data-[submitted=true]:text-accent-foreground"
            />
          }
        >
          <ThumbsDownIcon />
        </ActionBarPrimitive.FeedbackNegative>
      </AuiIf>
      <ActionBarPrimitive.Reload render={<TooltipIconButton tooltip="Refresh" />}>
        <RefreshCwIcon />
      </ActionBarPrimitive.Reload>
      <ActionBarMorePrimitive.Root>
        <ActionBarMorePrimitive.Trigger
          render={<TooltipIconButton tooltip="More" className="data-[state=open]:bg-accent" />}
        >
          <MoreHorizontalIcon />
        </ActionBarMorePrimitive.Trigger>
        <ActionBarMorePrimitive.Content
          side="bottom"
          align="start"
          sideOffset={6}
          className="aui-action-bar-more-content bg-popover text-popover-foreground data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=closed]:animate-out data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 min-w-[8rem] overflow-hidden rounded-xl border p-1.5"
        >
          <ActionBarPrimitive.ExportMarkdown
            render={
              <ActionBarMorePrimitive.Item className="aui-action-bar-more-item hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm outline-none select-none" />
            }
          >
            <DownloadIcon className="size-4" />
            Export as Markdown
          </ActionBarPrimitive.ExportMarkdown>
        </ActionBarMorePrimitive.Content>
      </ActionBarMorePrimitive.Root>
    </ActionBarPrimitive.Root>
  );
};

const UserFilePart: FileMessagePartComponent = (part) => (
  <div data-slot="aui_user-message-file" className="py-1">
    <File {...part} />
  </div>
);

const UserImagePart: ImageMessagePartComponent = (part) => (
  <div data-slot="aui_user-message-image" className="py-1">
    <Image {...part} />
  </div>
);

const UserMessage: FC = () => {
  return (
    <MessagePrimitive.Root
      data-slot="aui_user-message-root"
      className="fade-in slide-in-from-bottom-1 animate-in grid auto-rows-auto grid-cols-[minmax(72px,1fr)_auto] content-start gap-y-2 px-2 duration-150 [contain-intrinsic-size:auto_200px] [content-visibility:auto] [&:where(>*)]:col-start-2"
      data-role="user"
    >
      <UserMessageAttachments />

      <div className="aui-user-message-content-wrapper relative col-start-2 min-w-0">
        <div className="aui-user-message-content peer bg-background text-foreground shadow-sm rounded-(--composer-radius) px-4 py-2 wrap-break-word empty:hidden">
          <MessagePrimitive.Parts components={{ File: UserFilePart, Image: UserImagePart }} />
        </div>
        <div className="aui-user-action-bar-wrapper absolute start-0 top-1/2 -translate-x-full -translate-y-1/2 pe-2 peer-empty:hidden rtl:translate-x-full">
          <UserActionBar />
        </div>
      </div>

      <BranchPicker
        data-slot="aui_user-branch-picker"
        className="col-span-full col-start-1 -me-1 justify-end"
      />

      {/* 003 发音弹窗入口（发音/地道，原型图按钮行）。
          注：理想挂载点是"语音用户气泡"（SpokenMessage 分支也挂了同一组件），
          但全仓库无任何代码写入 metadata.modality="voice"（语音轮次经 IAT 转写
          后与文字轮次同样以纯文本消息呈现），SpokenMessage 分支实际不可达；
          因此入口同时挂文本用户消息（本处），保证功能可达——无评测数据的轮次
          由弹窗空态兜底（FR-015），符合 spec"缺失数据不虚构"约定 */}
      <PronunciationEntry />
    </MessagePrimitive.Root>
  );
};

const UserActionBar: FC = () => {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="aui-user-action-bar-root flex flex-col items-end"
    >
      <ActionBarPrimitive.Edit
        render={<TooltipIconButton tooltip="Edit" className="aui-user-action-edit" />}
      >
        <PencilIcon />
      </ActionBarPrimitive.Edit>
    </ActionBarPrimitive.Root>
  );
};

const EditComposer: FC = () => {
  return (
    <MessagePrimitive.Root
      data-slot="aui_edit-composer-wrapper"
      className="flex flex-col px-2 [contain-intrinsic-size:auto_200px] [content-visibility:auto]"
    >
      <ComposerPrimitive.Root className="aui-edit-composer-root border-foreground/10 focus-within:border-foreground/25 ms-auto flex w-full max-w-[85%] cursor-text flex-col rounded-(--composer-radius) border bg-(--composer-bg) transition-[border-color]">
        <ComposerPrimitive.Input
          className="aui-edit-composer-input text-foreground min-h-14 w-full resize-none bg-transparent px-4 pt-3 pb-1 text-base outline-none"
          autoFocus
        />
        <div className="aui-edit-composer-footer mx-2.5 mb-2.5 flex items-center gap-1.5 self-end">
          <ComposerPrimitive.Cancel
            render={<Button variant="ghost" size="sm" className="h-8 px-3" />}
          >
            Cancel
          </ComposerPrimitive.Cancel>
          <ComposerPrimitive.Send render={<Button size="sm" className="h-8 px-3" />}>
            Update
          </ComposerPrimitive.Send>
        </div>
      </ComposerPrimitive.Root>
    </MessagePrimitive.Root>
  );
};

const BranchPicker: FC<BranchPickerPrimitive.Root.Props> = ({ className, ...rest }) => {
  return (
    <BranchPickerPrimitive.Root
      hideWhenSingleBranch
      className={cn(
        "aui-branch-picker-root text-muted-foreground -ms-2 me-2 inline-flex items-center text-xs",
        className,
      )}
      {...rest}
    >
      <BranchPickerPrimitive.Previous render={<TooltipIconButton tooltip="Previous" />}>
        <ChevronLeftIcon />
      </BranchPickerPrimitive.Previous>
      <span className="aui-branch-picker-state font-medium">
        <BranchPickerPrimitive.Number /> / <BranchPickerPrimitive.Count />
      </span>
      <BranchPickerPrimitive.Next render={<TooltipIconButton tooltip="Next" />}>
        <ChevronRightIcon />
      </BranchPickerPrimitive.Next>
    </BranchPickerPrimitive.Root>
  );
};
