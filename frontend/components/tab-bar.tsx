import { Home, LayoutGrid, User, type LucideIcon } from "lucide-react";

export type TabId = "chat" | "tab2" | "tab3";

export interface TabConfig {
  id: TabId;
  label: string;
  icon: LucideIcon;
}

/** 三 Tab 固定顺序，chat（自由对话）首位；文案按原型图（FR-001，data-model.md TabConfig） */
const TABS: TabConfig[] = [
  { id: "chat", label: "自由对话", icon: Home },
  { id: "tab2", label: "精讲课对话", icon: LayoutGrid },
  { id: "tab3", label: "我的", icon: User },
];

interface TabBarProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}

export function TabBar({ activeTab, onTabChange }: TabBarProps) {
  return (
    <nav className="flex shrink-0 items-stretch border-t bg-background">
      {TABS.map(({ id, label, icon: Icon }) => {
        const active = id === activeTab;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onTabChange(id)}
            aria-current={active ? "page" : undefined}
            className={`flex flex-1 flex-col items-center gap-1 py-2 text-xs transition-colors ${
              active ? "text-primary" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="size-5" />
            <span>{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
