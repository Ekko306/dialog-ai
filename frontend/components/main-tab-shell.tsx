"use client";

import { useState } from "react";
import { EmptyTab } from "@/components/empty-tab";
import { MainChatPage } from "@/components/main-chat-page";
import { MessagesPage } from "@/components/messages-page";
import { TabBar, type TabId } from "@/components/tab-bar";
import { MAIN_ROLE_ID } from "@/lib/role-catalog";

/**
 * 主框架 Shell（001 FR-001/FR-002，research R5；003 US1 扩展，US2 修订）：
 * 单页面组件级切换，无路由、无存储副作用。
 *
 * 003 US2 架构修订（T012）：ShellRoute 状态上移至 app/assistant.tsx ——
 * 角色级 useStreamRuntime 不允许嵌套在根 provider 内（库的 nesting 检测会把
 * 内层 runtime 降级为 no-op 并绑定宿主线程 → 会话串扰），角色树必须渲染在
 * 根 provider 之外的兄弟位置，故 route=role 分支由 app/assistant.tsx 直接处理。
 * 本组件只负责 tabs/messages 两态渲染，并把角色选择分发上抛（FR-003）。
 */
export type ShellRoute = { name: "tabs" } | { name: "messages" } | { name: "role"; roleId: string };

export function MainTabShell({
  route,
  onRouteChange,
}: {
  route: ShellRoute;
  onRouteChange: (route: ShellRoute) => void;
}) {
  const [activeTab, setActiveTab] = useState<TabId>("chat");

  const handleSelectRole = (roleId: string) => {
    if (roleId === MAIN_ROLE_ID) {
      // Alicia = 主对话线程，点击即回主对话（spec Assumption，quickstart 1.5/2.8）
      onRouteChange({ name: "tabs" });
    } else {
      // 其他角色 → 角色对话页（app/assistant.tsx 渲染 RoleChatPage，T012）
      onRouteChange({ name: "role", roleId });
    }
  };

  if (route.name === "messages") {
    return (
      <div className="h-dvh overflow-hidden">
        <MessagesPage
          onBack={() => onRouteChange({ name: "tabs" })}
          onSelectRole={handleSelectRole}
        />
      </div>
    );
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <div className="min-h-0 flex-1">
        {activeTab === "chat" ? (
          <MainChatPage onOpenMessages={() => onRouteChange({ name: "messages" })} />
        ) : (
          <EmptyTab />
        )}
      </div>
      <TabBar activeTab={activeTab} onTabChange={setActiveTab} />
    </div>
  );
}
