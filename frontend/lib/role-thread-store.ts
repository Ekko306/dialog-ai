/**
 * 角色会话线程元数据 store（003，数据契约：specs/003-switch-conversation-role/data-model.md §2.2；
 * research R4）：每角色一条最小元数据，仅存列表展示所需快照。
 * 消息正文不入库 —— 真值在 LangGraph Server checkpointer（Constitution 原则 III）。
 *
 * 未读语义（research R4 规则表）：unreadCount > 0 仅表示"离开该会话时它还有未完结的动静"
 * （预期回复在离开后送达），进入即清零（FR-004），不承诺离线消息精确条数。
 * localStorage 不可用（隐私模式）时 zustand persist 自动降级内存态（research R8 已知限制）。
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { BackendPersona } from "@/lib/backend-persona";

export interface RoleThreadMeta {
  roleId: string;
  /** LangGraph thread id；null = 尚未建线（从未发送过消息） */
  threadId: string | null;
  /** 最后一条非空文本消息预览（≤60 字符截断；空线程时为空串）——
   *  从后往前取第一条非空文本：后端每轮收尾写 SystemMessage("") 作气泡分隔符，
   *  messages 最后一条恒为空系统消息（取值见 main-chat-page.tsx lastPreviewText；
   *  与 data-model §2.2 语义修订同步，2026-10-27） */
  lastPreview: string;
  /** 最近活跃时间戳（ms）；null = 从未活跃 */
  lastActivityAt: number | null;
  /** 未读标记数（语义见文件头注释） */
  unreadCount: number;
}

export interface LeaveRoleSnapshot {
  roleId: string;
  threadId: string | null;
  /** 离开时该角色最后一条消息文本（调用方已截断亦可，store 内再次兜底截断）；
   *  空串 = 调用方未取到文本（历史 join 未完成等）→ store 保留旧外显不覆盖 */
  lastPreview: string;
  /** 离开时 isRunning / 有未消费新消息 → unreadCount += 1 */
  hasNewActivity: boolean;
}

interface RoleThreadState {
  metas: Record<string, RoleThreadMeta>;
  /**
   * 主对话（alicia/Ella）最近一次经弹窗应用的后端人设（002 选场景）；
   * null = 从未选过 → 主对话页挂载回写 MAIN_DEFAULT_PERSONA。
   * 用途：后端教练人设是全局单例 Store（见 backend-persona.ts 文件头），
   * 角色页挂载会覆盖它，主对话页挂载时靠此字段还原用户所选场景。
   */
  lastMainPersona: BackendPersona | null;
  /** 进入对话页：unreadCount 归零（FR-004 角标清除） */
  enterRole: (roleId: string) => void;
  /** 离开对话页：写预览/时间戳（必要时补写 threadId），按需 unreadCount += 1 */
  leaveRole: (snapshot: LeaveRoleSnapshot) => void;
  /** onThreadId 回调落库（首次建线后持久化，供再次进入时受控挂载） */
  setThreadId: (roleId: string, threadId: string) => void;
  /** 场景弹窗应用成功后记录（scene-applier 调用），供主对话页挂载还原 */
  setLastMainPersona: (persona: BackendPersona) => void;
  /**
   * 失效自愈（research R8）：绑定的线程在服务端已不存在（langgraph dev 重启清空
   * checkpointer 等）时重置为"从未对话"态——绑定只会来自已跑过 run 的线程回写，
   * 线程消息历史为空即说明快照已失效，一并清掉避免列表显示假预览。
   */
  resetThread: (roleId: string) => void;
}

/** 预览统一 ≤60 字符截断（data-model §2.2）；messages-page 复用同一常量（单一真源） */
export const PREVIEW_MAX_CHARS = 60;

function truncatePreview(text: string): string {
  return text.length > PREVIEW_MAX_CHARS ? text.slice(0, PREVIEW_MAX_CHARS) : text;
}

export const useRoleThreadStore = create<RoleThreadState>()(
  persist(
    (set) => ({
      metas: {},
      lastMainPersona: null,
      setLastMainPersona: (persona) => set({ lastMainPersona: persona }),
      enterRole: (roleId) =>
        set((state) => ({
          metas: {
            ...state.metas,
            [roleId]: {
              roleId,
              threadId: state.metas[roleId]?.threadId ?? null,
              lastPreview: state.metas[roleId]?.lastPreview ?? "",
              lastActivityAt: state.metas[roleId]?.lastActivityAt ?? null,
              unreadCount: 0,
            },
          },
        })),
      leaveRole: ({ roleId, threadId, lastPreview, hasNewActivity }) =>
        set((state) => {
          const prev = state.metas[roleId];
          // 空串兜底（防御修复 2026-10-27）：线程历史异步 join，若本次挂载期间未完成
          // 即离开，调用方 lastMessagesRef 仍为空、取不到非空文本——此时保留旧外显，
          // 避免把已有预览覆盖成空串导致消息页回落开场白（真·空线程 prev 也为空，行为不变）
          const nextPreview = lastPreview.trim()
            ? truncatePreview(lastPreview)
            : (prev?.lastPreview ?? "");
          return {
            metas: {
              ...state.metas,
              [roleId]: {
                roleId,
                threadId: threadId ?? prev?.threadId ?? null,
                lastPreview: nextPreview,
                lastActivityAt: Date.now(),
                unreadCount: (prev?.unreadCount ?? 0) + (hasNewActivity ? 1 : 0),
              },
            },
          };
        }),
      setThreadId: (roleId, threadId) =>
        set((state) => ({
          metas: {
            ...state.metas,
            [roleId]: {
              roleId,
              threadId,
              lastPreview: state.metas[roleId]?.lastPreview ?? "",
              lastActivityAt: state.metas[roleId]?.lastActivityAt ?? null,
              unreadCount: state.metas[roleId]?.unreadCount ?? 0,
            },
          },
        })),
      resetThread: (roleId) =>
        set((state) => ({
          metas: {
            ...state.metas,
            [roleId]: {
              roleId,
              threadId: null,
              lastPreview: "",
              lastActivityAt: null,
              unreadCount: 0,
            },
          },
        })),
    }),
    {
      name: "talkai-role-threads", // localStorage key（quickstart 前置条件表引用）
      partialize: (state) => ({ metas: state.metas, lastMainPersona: state.lastMainPersona }), // 仅持久化数据，actions 不落盘
    },
  ),
);
