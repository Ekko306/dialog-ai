import type { RoleCatalogEntry } from "@/lib/role-catalog";
import { RecommendedReplies } from "@/components/recommended-replies.aui";

/**
 * 角色对话页 Welcome 覆盖组件（003 T010/T015，research R6）：
 * 渲染角色大头像 + 预置开场白 + 首轮推荐回复（纯配置渲染，不写入线程历史）。
 * 挂载条件 = 线程无消息（thread.aui 的 isNewChatView）→ 首次进入必见（FR-006）、
 * 首条用户消息后随 Welcome 自动卸载（contracts/recommended-replies §1 生命周期）；
 * openingSuggestions 长度 0 → RecommendedReplies 内部返回 null，不留空位。
 */
export function RoleOpening({ role }: { role: RoleCatalogEntry }) {
  return (
    <div className="flex flex-col items-center gap-5 px-2 py-8 text-center">
      {role.avatar.kind === "image" ? (
        <img
          src={role.avatar.src}
          alt={role.name}
          className="size-20 shrink-0 rounded-full object-cover"
        />
      ) : (
        <div
          aria-hidden
          className={`flex size-20 shrink-0 items-center justify-center rounded-full text-2xl font-semibold ${role.avatar.colorClass}`}
        >
          {role.avatar.char}
        </div>
      )}
      <div className="bg-(--bubble-ai) text-foreground max-w-[32rem] rounded-xl px-4 py-3 text-start text-sm leading-relaxed whitespace-pre-wrap">
        {role.opening}
      </div>
      {/* 来源 A：首轮推荐回复（FR-010 前半），点击即作为用户消息发送 */}
      <RecommendedReplies replies={role.openingSuggestions} />
    </div>
  );
}
