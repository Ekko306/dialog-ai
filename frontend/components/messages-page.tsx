"use client";

import { ChevronLeftIcon } from "lucide-react";
import { useMemo, type FC } from "react";
import { ROLE_CATALOG, type RoleAvatar } from "@/lib/role-catalog";
import {
  PREVIEW_MAX_CHARS,
  useRoleThreadStore,
  type RoleThreadMeta,
} from "@/lib/role-thread-store";

/**
 * 全屏消息页（003 US1，FR-001~FR-004；对照原型图 2）：
 * 顶部返回箭头 + 居中"消息"标题；12 角色会话列表 = ROLE_CATALOG 全量渲染 +
 * role-thread-store 元数据派生（data-model §2.2 视图层派生规则）：
 * - 预览：meta.lastPreview 非空用它，否则用 catalog.opening 截断摘要（从未活跃角色）
 * - 时间戳：lastActivityAt 当天 HH:MM / 非当天 MM-DD / null 显示 "—"
 * - 排序：有 lastActivityAt 的降序在前，无记录的按 catalog 配置顺序垫底（sort 稳定）
 * - 角标：unreadCount > 0 显示红色圆形数字角标
 * 本组件不持有导航状态、不写 store：纯展示 + 回调上抛（onBack / onSelectRole，
 * 分发逻辑在 Shell，research R2）。
 */

// PREVIEW_MAX_CHARS 自 role-thread-store 导入（预览截断单一真源，data-model §2.2）

function truncate(text: string): string {
  return text.length > PREVIEW_MAX_CHARS ? text.slice(0, PREVIEW_MAX_CHARS) : text;
}

/** 当天 HH:MM / 非当天 MM-DD / null "—" */
function formatTimestamp(ts: number | null | undefined): string {
  if (ts == null) return "—";
  const date = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function Avatar({ avatar }: { avatar: RoleAvatar }) {
  if (avatar.kind === "image") {
    return <img src={avatar.src} alt="" className="size-12 shrink-0 rounded-full object-cover" />;
  }
  return (
    <div
      className={`flex size-12 shrink-0 items-center justify-center rounded-full text-lg font-semibold ${avatar.colorClass}`}
      aria-hidden
    >
      {avatar.char}
    </div>
  );
}

const MessagesPage: FC<{
  onBack: () => void;
  onSelectRole: (roleId: string) => void;
}> = ({ onBack, onSelectRole }) => {
  const metas = useRoleThreadStore((s) => s.metas);

  const rows = useMemo(() => {
    const withMeta = ROLE_CATALOG.map((entry) => ({
      entry,
      meta: metas[entry.id] as RoleThreadMeta | undefined,
    }));
    return withMeta.sort((a, b) => {
      const at = a.meta?.lastActivityAt ?? null;
      const bt = b.meta?.lastActivityAt ?? null;
      if (at != null && bt != null) return bt - at;
      if (at != null) return -1;
      if (bt != null) return 1;
      return 0; // 都无记录：保持 ROLE_CATALOG 配置顺序（sort 稳定）
    });
  }, [metas]);

  return (
    <div className="bg-background flex h-full min-h-0 flex-col">
      <header className="grid h-12 shrink-0 grid-cols-[1fr_auto_1fr] items-center px-4">
        <button
          type="button"
          onClick={onBack}
          aria-label="返回"
          className="text-foreground -m-1 cursor-pointer justify-self-start rounded-md p-1 transition-colors hover:bg-accent"
        >
          <ChevronLeftIcon className="size-5" aria-hidden />
        </button>
        <span className="text-base font-semibold">消息</span>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <ul>
          {rows.map(({ entry, meta }) => {
            const preview = meta?.lastPreview ? meta.lastPreview : truncate(entry.opening);
            const unread = meta?.unreadCount ?? 0;
            return (
              <li key={entry.id}>
                <button
                  type="button"
                  onClick={() => onSelectRole(entry.id)}
                  aria-label={`打开与${entry.name}的对话`}
                  className="hover:bg-accent/40 flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-start transition-colors"
                >
                  <div className="relative shrink-0">
                    <Avatar avatar={entry.avatar} />
                    {unread > 0 && (
                      <span
                        data-slot="messages-unread-badge"
                        className="bg-red-500 absolute -top-0.5 -left-1.5 flex size-5 items-center justify-center rounded-full text-[11px] font-medium text-white"
                      >
                        {unread}
                      </span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-foreground truncate text-[15px] font-semibold leading-tight">
                        {entry.name}
                      </span>
                      <span className="text-muted-foreground shrink-0 text-xs">
                        {formatTimestamp(meta?.lastActivityAt)}
                      </span>
                    </div>
                    <p className="text-muted-foreground mt-1 truncate text-sm">{preview}</p>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
};

export { MessagesPage };
