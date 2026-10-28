"use client";

import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { useStreamRuntime } from "@assistant-ui/react-langchain";
import { useState } from "react";
import { MainTabShell, type ShellRoute } from "@/components/main-tab-shell";
import { RoleAssistant } from "@/components/role-assistant";
import { RoleChatPage } from "@/components/role-chat-page";
import { serverDictationAdapter } from "@/components/server-dictation-adapter";

/**
 * 根 provider + 003 角色树宿主（US2 T012 架构修订，data-model §三）：
 *
 * ShellRoute（data-model §2.4）：纯内存 useState（原属 MainTabShell，因下述
 * 渲染结构修订上移到本组件），不持久化（刷新回主界面，可接受）。
 * 状态转移：tabs --消息入口--> messages --点击角色--> role --返回--> messages；
 * messages --点击 Alicia--> tabs。
 *
 * 角色树与根 provider 树互斥渲染（兄弟而非嵌套）：角色级 useStreamRuntime
 * 不允许嵌套在根 provider 内（nesting 检测降级 no-op → 绑定宿主线程串扰）。
 * 同时根 provider 必须全程挂载（其内部托管的 useStream 实例随 provider 卸载而
 * 销毁 → Alicia 流状态丢失），因此 route=role 时仅卸载 shell 内容
 * （MainChatPage 卸载 → Alicia 快照/停 AutoContinue，与 messages 路由同语义），
 * 根 runtime 实例与流状态在 role 页期间保持存活，返回即恢复（research R5）。
 */
export function Assistant() {
  const [route, setRoute] = useState<ShellRoute>({ name: "tabs" });

  const apiUrl =
    process.env.NEXT_PUBLIC_LANGGRAPH_API_URL ||
    (typeof window !== "undefined" ? new URL("/api", window.location.href).href : undefined);

  const runtime = useStreamRuntime({
    assistantId: process.env.NEXT_PUBLIC_LANGGRAPH_ASSISTANT_ID!,
    apiUrl,
    // 语音输入：官方 DictationAdapter 接口（US3，见 server-dictation-adapter.ts）
    adapters: { dictation: serverDictationAdapter },
  });

  return (
    <>
      {route.name === "role" && (
        <RoleAssistant roleId={route.roleId}>
          <RoleChatPage roleId={route.roleId} onBack={() => setRoute({ name: "messages" })} />
        </RoleAssistant>
      )}
      <AssistantRuntimeProvider runtime={runtime}>
        {route.name === "role" ? null : <MainTabShell route={route} onRouteChange={setRoute} />}
      </AssistantRuntimeProvider>
    </>
  );
}
