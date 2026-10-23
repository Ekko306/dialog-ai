"use client";

import { useState } from "react";
import { EmptyTab } from "@/components/empty-tab";
import { MainChatPage } from "@/components/main-chat-page";
import { TabBar, type TabId } from "@/components/tab-bar";

/**
 * 主框架 Shell（FR-001/FR-002，research R5）：
 * 单页面组件级切换，useState 管理激活 Tab（默认 chat），无路由、无存储副作用。
 * 由 app/assistant.tsx 的 AssistantRuntimeProvider 包裹，provider 不随 Tab 切换卸载（FR-007）。
 */
export function MainTabShell() {
  const [activeTab, setActiveTab] = useState<TabId>("chat");

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <div className="min-h-0 flex-1">{activeTab === "chat" ? <MainChatPage /> : <EmptyTab />}</div>
      <TabBar activeTab={activeTab} onTabChange={setActiveTab} />
    </div>
  );
}
