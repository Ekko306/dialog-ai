"use client";

import { CheckIcon, CopyIcon, StarIcon } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import {
  listFavorites,
  removeFavorite,
  subscribeFavorites,
  type FavoriteItem,
} from "@/components/pronunciation-popup/favorites-store";
import { ttsSourceKey, usePopupAudio } from "@/components/pronunciation-popup/use-popup-audio";
import { getSettings } from "@/lib/profile-settings";
import { cn } from "@/lib/utils";

/**
 * 我的收藏区块（US3，原型图第三卡，FR-008/009）：
 * 收藏列表（风格标签/英文/中文，savedAt 倒序）+ 操作行（复制 / AI 朗读 / 取消收藏）；
 * useSyncExternalStore(subscribeFavorites) 订阅共享 store，与 003 弹窗双向同步（SC-006）；
 * AI 朗读复用 use-popup-audio 单例播放器，accent 读设置（research R4③）；
 * 空态引导文案（FR-013）。
 */

const STYLE_LABELS: Record<string, string> = {
  american: "地道美式",
  business: "商务正式",
  british: "地道英式",
};

export function FavoritesSection() {
  const favorites = useSyncExternalStore(subscribeFavorites, listFavorites, listFavorites);
  const audio = usePopupAudio();

  // 复制成功反馈：图标短暂切换为 ✓（按 item.key 记录，参照 polish-section 模式）
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    [],
  );

  const handleCopy = (item: FavoriteItem) => {
    void navigator.clipboard.writeText(item.en).then(() => {
      setCopiedKey(item.key);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopiedKey(null), 1500);
    });
  };

  return (
    <section className="rounded-2xl bg-background p-5 shadow-sm" data-slot="profile-favorites">
      <h2 className="text-sm font-semibold">我的收藏</h2>

      {favorites.length === 0 ? (
        <p className="text-muted-foreground py-8 text-center text-sm">
          暂无收藏；在发音弹窗的语境润色区点击 ☆，即可沉淀你的地道表达
        </p>
      ) : (
        <div className="mt-3 space-y-3">
          {favorites.map((item) => {
            const accent = getSettings().accent;
            const active =
              audio.activeKey === ttsSourceKey(accent, item.en) && audio.status !== "idle";
            const copied = copiedKey === item.key;
            return (
              <div key={item.key} className="rounded-xl border border-black/5 px-4 py-3">
                <span className="bg-primary/10 text-primary rounded-full px-2.5 py-0.5 text-[11px]">
                  {STYLE_LABELS[item.style] ?? item.style}
                </span>
                <p className="mt-2 text-[15px] font-semibold wrap-break-word">{item.en}</p>
                {item.zh && (
                  <p className="text-muted-foreground mt-1 text-[13px] wrap-break-word">{item.zh}</p>
                )}
                <div className="mt-3 flex items-center gap-3 text-[13px]">
                  <button
                    type="button"
                    onClick={() => handleCopy(item)}
                    className={cn(
                      "flex items-center gap-1 rounded-lg border border-black/10 px-3 py-1.5 transition-colors hover:border-primary hover:text-primary",
                      copied && "border-primary text-primary",
                    )}
                  >
                    {copied ? (
                      <CheckIcon className="size-3.5" aria-hidden />
                    ) : (
                      <CopyIcon className="size-3.5" aria-hidden />
                    )}
                    {copied ? "已复制" : "复制"}
                  </button>
                  <button
                    type="button"
                    onClick={() => audio.play({ kind: "tts", text: item.en, accent })}
                    className={cn(
                      "flex items-center gap-1 rounded-lg border border-black/10 px-3 py-1.5 transition-colors hover:border-primary hover:text-primary",
                      active && "border-primary text-primary",
                    )}
                  >
                    🔊 AI 朗读
                  </button>
                  <button
                    type="button"
                    onClick={() => removeFavorite(item.key)}
                    className="text-muted-foreground flex items-center gap-1 rounded-lg border border-black/10 px-3 py-1.5 transition-colors hover:border-red-400 hover:text-red-500"
                  >
                    <StarIcon className="size-3.5" aria-hidden />
                    取消收藏
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 播放/合成错误外显（FR-015 不静默失败） */}
      {audio.error && <p className="mt-2 text-xs text-red-500">{audio.error}</p>}
    </section>
  );
}
