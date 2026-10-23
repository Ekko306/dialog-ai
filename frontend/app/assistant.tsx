"use client";

import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { useStreamRuntime } from "@assistant-ui/react-langchain";
import { MainTabShell } from "@/components/main-tab-shell";
import { serverDictationAdapter } from "@/components/server-dictation-adapter";

export function Assistant() {
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
    <AssistantRuntimeProvider runtime={runtime}>
      <MainTabShell />
    </AssistantRuntimeProvider>
  );
}
