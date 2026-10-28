import { useLangChainError, useLangChainStream } from "@assistant-ui/react-langchain";
import { ArrowLeft, SlidersHorizontal, Volume2 } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { InterruptPrompt } from "@/components/interrupt-prompt";
import { lastPreviewText } from "@/components/main-chat-page";
import { RoleOpening } from "@/components/role-opening";
import { AssistantSuggestions } from "@/components/recommended-replies.aui";
import { Thread } from "@/components/thread.aui";
import { AutoContinue, NewDialogButton } from "@/components/talk-flow";
import { ROLE_PERSONAS } from "@/lib/backend-persona";
import { getRole, type RoleCatalogEntry } from "@/lib/role-catalog";
import { useRoleThreadStore } from "@/lib/role-thread-store";

/**
 * 角色对话页壳（003 T011，对照原型图 3，research R1/R7）：
 * - 顶栏：左返回、中位角色头像+名称（与主对话顶栏一致，2026-10-27 用户反馈补充）、右静态音量/设置图标（无子功能支撑，同 001 FR-010 静态展示，不做成按钮）
 * - 消息流：Thread（components.Welcome = RoleOpening，含大头像 + 开场白）
 * - 底部常驻区：InterruptPrompt（HITL 唯一输入框）+ AutoContinue，
 *   不渲染「选场景」（002 场景指令仅作用于主对话线程，超范围）
 * - RoleStartButton：空线程首条消息通道（架构备注，见其注释）
 * - 错误兜底：useLangChainError 在顶栏下方渲染轻量错误条（research R8）
 * - RoleSnapshot：挂载 enterRole（角标清零）、卸载 leaveRole 快照
 *   （最后一条消息截 60 字符 + isRunning → 未读标记，research R4 规则表）
 * - FR-011：目录条目缺失或字段异常 → 全屏空态「该角色暂时无法使用」，不白屏
 */

/**
 * 「新会话」常显入口（对 T011「不渲染 NewDialogButton」的受控偏离，2026-10-27 常显化）：
 * thread.aui 现状无 Composer（R7 假设已过时，唯一输入面是 InterruptPrompt）。
 * 常显动机：图跑到 END 且滞留 error 锁死 AutoContinue 时（2026-10-27 Lisa 死锁实测），
 * 有历史的线程也没有任何续跑入口——与主对话同款常显语义：
 * 空线程 → submit({}) 出首轮话题；停 HITL → respond _set_context_ 按本角色人设
 * 出新话题（2026-10-27 人设防串台：角色页不能用 _new_context_——那是主对话的
 * 全局场景轮换，会把角色页人设轮换成场景序列里的下一个）；
 * 图 END → submit({}) 直接续出新话题（逃生路径）。
 */
function RoleStartButton({ roleId }: { roleId: string }) {
  const persona = ROLE_PERSONAS[roleId];
  // 防御（2026-10-27）：目录加了新角色而 ROLE_PERSONAS 漏配时，绝不能回退发
  // _new_context_——那是主对话的全局场景轮换指令，会把角色页人设轮换成场景序列
  // 的下一个（串台回归）。不渲染"新会话"比静默发错误指令安全（HITL 输入仍可用）。
  if (!persona) return null;
  return (
    <NewDialogButton
      persona={persona}
      contextCommand={`_set_context_::${persona.role}::${persona.scenario}`}
      // END/死锁线程的逃生路径改走"新线程重启"（同线程续跑会触发后端
      // continue_dialog 的 raw_text=None 崩溃，2026-10-28）——见 NewDialogButton
      viaNewThread
    />
  );
}

/**
 * 轻量错误条：run 出错时提示（含「上一轮 run 失败后重新进入页面 join 重放错误」的场景）。
 * 错误时效：SDK 的 stream.error 在后续成功 run 后不清除（透传 root.error），
 * 因此错误定格在出现时的消息数上——此后若对话有新进展（消息数变化）则视为过期隐藏；
 * 同一位置再次出错（新错误对象）会重新记录并显示。
 */
function RoleErrorBar() {
  const error = useLangChainError();
  const stream = useLangChainStream();
  const messagesLen = stream?.messages?.length ?? 0;
  const lastErrorRef = useRef<unknown>(null);
  const errAtLenRef = useRef<number | null>(null);
  if (error !== lastErrorRef.current) {
    lastErrorRef.current = error;
    errAtLenRef.current = error != null ? messagesLen : null;
  }
  const stale = error != null && errAtLenRef.current !== messagesLen;
  if (!error || stale) return null;
  return (
    <div
      role="alert"
      className="border-destructive/30 bg-destructive/10 text-destructive px-4 py-2 text-sm"
    >
      对话出现错误，可直接继续对话；若持续出错，返回消息页重新进入
    </div>
  );
}

/** 线程元数据快照接线：mount → enterRole（角标清零），unmount → leaveRole 快照 */
function RoleSnapshot({ roleId }: { roleId: string }) {
  const stream = useLangChainStream();
  const enterRole = useRoleThreadStore((s) => s.enterRole);
  const leaveRole = useRoleThreadStore((s) => s.leaveRole);
  // latest-ref：卸载回调里读取 stream 的最终状态（消息/isLoading/threadId）
  const streamRef = useRef(stream);
  streamRef.current = stream;
  // 最近一次非空消息快照：线程历史异步 join，加载完成前离开会取到空列表，
  // 直接写 lastPreview 会用空串覆盖已有外显（2026-10-27 实测）。用最近非空快照兜底。
  const lastMessagesRef = useRef<readonly unknown[]>([]);
  const currentMessages = (stream?.messages ?? []) as readonly unknown[];
  if (currentMessages.length > 0) {
    lastMessagesRef.current = currentMessages;
  }

  useEffect(() => {
    enterRole(roleId);
    return () => {
      const s = streamRef.current;
      const messages = lastMessagesRef.current;
      leaveRole({
        roleId,
        threadId: s?.threadId ?? null,
        lastPreview: lastPreviewText(messages),
        hasNewActivity: Boolean(s?.isLoading),
      });
    };
  }, [roleId, enterRole, leaveRole]);

  return null;
}

function RolePageHeader({ onBack, role }: { onBack: () => void; role?: RoleCatalogEntry }) {
  return (
    <header className="grid h-12 shrink-0 grid-cols-[1fr_auto_1fr] items-center border-b bg-background px-4">
      <button
        type="button"
        onClick={onBack}
        aria-label="返回消息"
        className="text-foreground -m-1 cursor-pointer justify-self-start rounded-md p-1 transition-colors hover:bg-accent"
      >
        <ArrowLeft className="size-5" aria-hidden />
      </button>
      {/* 顶栏中位：角色头像 + 名称（与主对话 Ella 顶栏同款样式，2026-10-27 用户反馈补充）；
          RoleUnavailable 兜底态无角色数据 → 保持空占位 */}
      {role ? (
        <div className="flex items-center gap-2">
          {role.avatar.kind === "image" ? (
            <img
              src={role.avatar.src}
              alt=""
              aria-hidden
              className="size-8 shrink-0 rounded-full object-cover"
            />
          ) : (
            <div
              className={`${role.avatar.colorClass} flex size-8 items-center justify-center rounded-full text-sm font-semibold`}
              aria-hidden
            >
              {role.avatar.char}
            </div>
          )}
          <span className="text-base font-semibold">{role.name}</span>
        </div>
      ) : (
        <span />
      )}
      <div className="flex items-center gap-3 justify-self-end" aria-hidden>
        <Volume2 className="text-(--icon-brand-green) size-5" />
        <SlidersHorizontal className="text-foreground size-5" />
      </div>
    </header>
  );
}

/** FR-011 兜底空态：目录条目缺失 / 字段异常时不白屏不悬挂 */
function RoleUnavailable({ onBack }: { onBack: () => void }) {
  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <RolePageHeader onBack={onBack} />
      <div className="text-muted-foreground flex flex-1 items-center justify-center text-sm">
        该角色暂时无法使用
      </div>
    </div>
  );
}

export function RoleChatPage({ roleId, onBack }: { roleId: string; onBack: () => void }) {
  const role = getRole(roleId);
  if (!role || !role.avatar || !role.opening) {
    return <RoleUnavailable onBack={onBack} />;
  }
  return <RoleChatPageInner roleId={roleId} onBack={onBack} role={role} />;
}

function RoleChatPageInner({
  roleId,
  onBack,
  role,
}: {
  roleId: string;
  onBack: () => void;
  role: RoleCatalogEntry;
}) {
  // Welcome 组件类型稳定化（role 为目录常量、引用恒定）：内联箭头组件每次渲染
  // 都是新类型 → Thread 内部按组件类型协调会反复 remount 空线程视图
  const welcomeComponent = useMemo(() => {
    const Welcome = () => <RoleOpening role={role} />;
    return Welcome;
  }, [role]);

  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden">
      <RolePageHeader onBack={onBack} role={role} />
      {/* RoleAssistant 由 app/assistant.tsx 在外层提供（T012 架构：兄弟互斥渲染）；
          此处不得再包一层 —— 嵌套 useStreamRuntime 在 allowNesting 下是 no-op 包装，
          会用外层当前线程重建 runtime 再套 provider，产生双 useStream 实例竞态
          （实测导致 US3 chips 无法稳定渲染） */}
      <RoleErrorBar />
      <div className="relative min-h-0 flex-1">
        <Thread
          components={{
            Welcome: welcomeComponent,
            AssistantSuggestions,
          }}
        />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col gap-4 px-4 pb-4 md:pb-6">
          <div className="pointer-events-auto mx-auto flex w-full max-w-[44rem] flex-col gap-3">
            <RoleStartButton roleId={roleId} />
            <InterruptPrompt />
            <AutoContinue />
          </div>
        </div>
      </div>
      <RoleSnapshot roleId={roleId} />
    </div>
  );
}
