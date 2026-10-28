import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { useStreamRuntime } from "@assistant-ui/react-langchain";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ensureBackendPersona, ROLE_PERSONAS } from "@/lib/backend-persona";
import { serverDictationAdapter } from "@/components/server-dictation-adapter";
import { useRoleThreadStore } from "@/lib/role-thread-store";

/**
 * 角色级 runtime provider（003 T009，research R1/R7）：
 * 每角色一个独立 useStreamRuntime 实例 + AssistantRuntimeProvider，
 * 同一 talk_agent graph，会话隔离由 LangGraph thread_id 天然保证。
 *
 * 关键约束（实测 @assistant-ui/react-langchain 0.0.32 / @assistant-ui/core 源码）：
 * 1. useStreamRuntime 不可嵌套在另一个 RemoteThreadListRuntime 的 provider 内 ——
 *    useRemoteThreadListRuntime 检测到宿主 threadListItem scope（source 非 null）
 *    时降级为 no-op，内部 hooks 将绑定宿主线程 → 会话串扰。因此本组件必须渲染在
 *    根 provider 之外（app/assistant.tsx 中与根 provider 互斥的兄弟树，
 *    架构修订见 tasks.md T012 备注）。
 * 2. 受控 threadId 参数未被 useStreamRuntime 转发到 RemoteThreadList 层
 *    （内部 useStream({ threadId: externalId }) 以 externalId 为准），
 *    附着既有线程用挂载后 runtime.threads.switchToThread(persistedThreadId)
 *    （join-rejoin，quickstart 2.6/2.9）；新建线程的 id 通过 onThreadIdChange
 *    （只发已确定的远端 id）回写 role-thread-store 持久化。
 */

/**
 * 角色线程列表适配器：list 恒空（线程清单由 role-thread-store 承担）；
 * fetch 把任意 id 映射为常规线程槽（remoteId = externalId = LangGraph thread id）；
 * initialize 回带持久化 threadId（首次建线为 undefined）；
 * generateTitle 返回官方 InMemoryThreadListAdapter 同款立即关闭的空流（角色页无标题）。
 * 失效 threadId（后端重启等）经 fetch 正常入槽，水合表现为空线程（research R8 自愈）。
 */
function createRoleThreadListAdapter(initialThreadId: string | null) {
  return {
    list: async () => ({ threads: [] }),
    fetch: async (threadId: string) => ({
      status: "regular" as const,
      remoteId: threadId,
      externalId: threadId,
    }),
    initialize: async (remoteId: string) => ({
      remoteId,
      externalId: initialThreadId ?? undefined,
    }),
    rename: async () => {},
    archive: async () => {},
    unarchive: async () => {},
    delete: async () => {},
    generateTitle: async () =>
      new ReadableStream({
        start(controller) {
          controller.close();
        },
      }),
  };
}

export function RoleAssistant({ roleId, children }: { roleId: string; children: ReactNode }) {
  const apiUrl =
    process.env.NEXT_PUBLIC_LANGGRAPH_API_URL ||
    (typeof window !== "undefined" ? new URL("/api", window.location.href).href : undefined);
  const setThreadId = useRoleThreadStore((s) => s.setThreadId);
  const resetThread = useRoleThreadStore((s) => s.resetThread);

  // 进入角色页时对持久化 threadId 取一次快照：首条消息建线后 store 写回
  // 不回流本实例（避免受控值复变触发多余的重附着/再水合）
  const [initialThreadId] = useState(
    () => useRoleThreadStore.getState().metas[roleId]?.threadId ?? null,
  );

  // 适配器引用必须跨渲染稳定（官方约束：替换会重载线程列表）；
  // initialThreadId 是挂载期快照，恒定 → 适配器恒定
  const threadListAdapter = useMemo(
    () => createRoleThreadListAdapter(initialThreadId),
    [initialThreadId],
  );

  const runtime = useStreamRuntime({
    assistantId: process.env.NEXT_PUBLIC_LANGGRAPH_ASSISTANT_ID!,
    apiUrl,
    adapters: { dictation: serverDictationAdapter },
    // 拿到已确定的远端 id 才落库（新建线程初始化后 / switchToThread 后均会触发）
    onThreadIdChange: (threadId) => {
      if (threadId) setThreadId(roleId, threadId);
    },
    unstable_threadListAdapter: threadListAdapter,
  });

  // 人设防串台（backend-persona.ts）：后端教练人设是全局单例 Store，主对话/其他
  // 角色页挂载会覆盖它——本角色页挂载时写入本角色人设，保证本页发起的一切新话题
  // run（首轮 submit / AutoContinue 续跑 / 新会话）读到正确人设
  useEffect(() => {
    const persona = ROLE_PERSONAS[roleId];
    if (!apiUrl || !persona) return;
    void ensureBackendPersona(apiUrl, persona);
  }, [roleId, apiUrl]);

  // 挂载后附着持久化线程（历史水合由内部 useStream 的 threadId=externalId 驱动）。
  // 失效自愈（research R8 落地）：绑定只来自已跑过 run 的线程回写，因此探测到该线程
  // 在服务端已无消息历史（langgraph dev 重启清空 checkpointer 等）即判定失效——
  // 重置 store 绑定并切到新线程，用户无需手清 localStorage 即可重新开始对话；
  // 探测本身失败（网络抖动/后端未起）时保守按"存在"处理，走原附着路径。
  useEffect(() => {
    if (!initialThreadId) return;
    let cancelled = false;
    void (async () => {
      let alive = true;
      try {
        const res = await fetch(`${apiUrl}/threads/${initialThreadId}/state`);
        if (!res.ok) {
          alive = false;
        } else {
          const state = (await res.json()) as { values?: { messages?: unknown[] } };
          alive = (state.values?.messages?.length ?? 0) > 0;
        }
      } catch {
        alive = true; // 探测不了就假定活着，避免误清
      }
      if (cancelled) return;
      if (alive) {
        runtime.threads.switchToThread(initialThreadId).catch(() => {});
        return;
      }
      resetThread(roleId);
      runtime.threads.switchToNewThread();
    })();
    return () => {
      cancelled = true;
    };
  }, [runtime, initialThreadId, apiUrl, roleId, resetThread]);

  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>;
}
