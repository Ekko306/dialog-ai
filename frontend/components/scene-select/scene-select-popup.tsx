"use client";

import { useState } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { ArrowLeft, X } from "lucide-react";

import { cn } from "cn";
import {
  SCENE_CATEGORIES,
  getEntriesByCategory,
  type CategoryId,
  type SceneCatalogEntry,
} from "@/lib/scene-catalog";
import { useSceneStore } from "@/lib/scene-store";

/**
 * "选择场景或角色"底部弹窗（FR-002~FR-006/FR-009，原型图：
 * frontend/docs/mockups/子功能-语音工具-选场景弹出弹窗.png）。
 * - 基于 @base-ui/react Dialog 原语自建底部滑出样式（不改动 ui/dialog.tsx 既有封装）；
 *   关闭即卸载 Popup 内容 → 内部 state 每次打开重置为默认态（clarify 决策③：热门选中、无卡片标记）
 * - 结构：标题栏（左标题右×）→ 分类胶囊栏（横向滑动）→ 双列话题卡片（纵向滚动）→
 *   底部固定"自定义场景/角色"按钮（FR-009）
 * - 点击卡片：选中高亮 → requestScene 写入 pendingScene → 关闭弹窗（FR-006；
 *   生效由 scene-applier.tsx 在 interrupt 出现时经 _set_context_ 指令完成）
 * - 自定义视图（用户扩展需求）：底部按钮切换到表单，输入自定义角色/场景后复用同一
 *   requestScene → _set_context_ 生效链路（后端契约本就接受任意字符串，FR-014 同样满足）；
 *   输入净化：`::` 替换为全角冒号（指令分隔符保留）、截断 24 字符（契约 §2 载荷约束）
 */

interface SceneSelectPopupProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SceneSelectPopup({ open, onOpenChange }: SceneSelectPopupProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop
          className="fixed inset-0 isolate z-50 bg-black/40 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
          aria-hidden
        />
        <DialogPrimitive.Popup
          className={cn(
            "bg-secondary text-popover-foreground fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[85dvh] w-full max-w-[44rem] flex-col rounded-t-3xl shadow-lg outline-none duration-200",
            "data-open:animate-in data-open:slide-in-from-bottom data-closed:animate-out data-closed:slide-out-to-bottom",
          )}
        >
          <SceneSelectContent onClose={() => onOpenChange(false)} />
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/**
 * 自定义输入净化：`::` 是 _set_context_ 指令的分隔符，必须替换；
 * 24 字符上限与后端 set_context_node 的截断防御对齐（契约 §2）
 */
function sanitizeSceneInput(value: string): string {
  return value.replace(/::/g, "：").trim().slice(0, 24);
}

/**
 * 弹窗内容子组件：状态必须定义在这一层（Portal 内容随关闭卸载），
 * 保证每次打开都重置为默认态（clarify 决策③：选中"热门"、无卡片标记）。
 * 双视图：catalog（分类+卡片，默认）↔ custom（自定义表单，由底部按钮进入）
 */
function SceneSelectContent({ onClose }: { onClose: () => void }) {
  const [view, setView] = useState<"catalog" | "custom">("catalog");
  const [activeCategory, setActiveCategory] = useState<CategoryId>("hot");
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const requestScene = useSceneStore((s) => s.requestScene);

  const entries = getEntriesByCategory(activeCategory);

  const handleSelect = (entry: SceneCatalogEntry) => {
    setSelectedEntryId(entry.id);
    requestScene(entry);
    onClose();
  };

  const handleCustomConfirm = (role: string, scenario: string) => {
    requestScene({
      role: sanitizeSceneInput(role) || "英语口语教练",
      scenario: sanitizeSceneInput(scenario),
    });
    onClose();
  };

  if (view === "custom") {
    return <CustomSceneForm onBack={() => setView("catalog")} onConfirm={handleCustomConfirm} />;
  }

  return (
    <>
      {/* 标题栏：左标题右关闭×（FR-002） */}
      <div className="flex shrink-0 items-center justify-between px-5 pt-5 pb-2">
        <DialogPrimitive.Title className="text-base font-semibold">
          选择场景或角色
        </DialogPrimitive.Title>
        <DialogPrimitive.Close
          aria-label="关闭"
          className="text-muted-foreground hover:text-foreground flex size-8 items-center justify-center rounded-full transition-colors"
        >
          <X className="size-4.5" />
        </DialogPrimitive.Close>
      </div>

      {/* 分类胶囊栏：横向滑动，默认"热门"（FR-003）；下方全宽细分隔线（原型图）；
          onWheel：桌面鼠标滚轮只产生垂直滚动量（deltaY），浏览器不会自动映射到横向滚动，
          导致滚轮悬停在分类栏上"没反应"——手动把 deltaY 转为横向滚动（触摸板双指横滑
          走原生 deltaX 路径，不受影响） */}
      <div
        className="shrink-0 overflow-x-auto border-b border-black/5 px-5 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        onWheel={(e) => {
          if (e.deltaY !== 0) e.currentTarget.scrollLeft += e.deltaY;
        }}
      >
        <div className="flex w-max gap-2">
          {[...SCENE_CATEGORIES]
            .sort((a, b) => a.order - b.order)
            .map((category) => (
              <button
                key={category.id}
                type="button"
                onClick={() => setActiveCategory(category.id)}
                className={cn(
                  "shrink-0 rounded-full px-4 py-1.5 text-sm transition-colors",
                  activeCategory === category.id
                    ? "bg-(--scene-highlight) text-foreground font-semibold"
                    : "bg-foreground/5 text-foreground/70 hover:bg-foreground/10",
                )}
              >
                {category.label}
              </button>
            ))}
        </div>
      </div>

      {/* 双列话题卡片网格：纵向滚动，空态兜底（FR-004/FR-005）；底部留白避开悬浮按钮；
          滚动条隐藏（原型图无可见滚动条，滚轮/触摸仍可滚动） */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-3 pb-24 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {entries.length === 0 ? (
          <div className="text-muted-foreground flex h-40 items-center justify-center text-sm">
            该分类暂无场景，敬请期待
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            {entries.map((entry) => (
              <SceneCard
                key={entry.id}
                entry={entry}
                selected={selectedEntryId === entry.id}
                onSelect={() => handleSelect(entry)}
              />
            ))}
          </div>
        )}
      </div>

      {/* 底部固定"自定义场景/角色"按钮（FR-009）：悬浮于卡片列表之上（原型图），点击进入自定义表单 */}
      <div className="pointer-events-none absolute inset-x-0 bottom-5 flex justify-center">
        <button
          type="button"
          onClick={() => setView("custom")}
          className={cn(
            "bg-(--scene-highlight) text-foreground pointer-events-auto w-[85%] rounded-full py-3",
            "text-[15px] font-semibold shadow-md transition-[filter] hover:brightness-95",
          )}
        >
          自定义场景/角色
        </button>
      </div>
    </>
  );
}

/**
 * 自定义场景/角色表单：角色可空（回退默认"英语口语教练"），场景必填。
 * 确认后走与选卡片相同的 requestScene → _set_context_ 生效链路。
 */
function CustomSceneForm({
  onBack,
  onConfirm,
}: {
  onBack: () => void;
  onConfirm: (role: string, scenario: string) => void;
}) {
  const [role, setRole] = useState("");
  const [scenario, setScenario] = useState("");
  const canConfirm = sanitizeSceneInput(scenario).length > 0;

  return (
    <>
      {/* 标题栏：返回箭头 + 标题 + 关闭× */}
      <div className="flex shrink-0 items-center justify-between px-5 pt-5 pb-2">
        <button
          type="button"
          onClick={onBack}
          aria-label="返回"
          className="text-muted-foreground hover:text-foreground -ml-2 flex size-8 items-center justify-center rounded-full transition-colors"
        >
          <ArrowLeft className="size-4.5" />
        </button>
        <DialogPrimitive.Title className="text-base font-semibold">
          自定义场景/角色
        </DialogPrimitive.Title>
        <DialogPrimitive.Close
          aria-label="关闭"
          className="text-muted-foreground hover:text-foreground -mr-2 flex size-8 items-center justify-center rounded-full transition-colors"
        >
          <X className="size-4.5" />
        </DialogPrimitive.Close>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-4 pb-6">
        <p className="text-muted-foreground text-sm">
          描述你想要的角色和对话场景，教练将按此设定与你练习口语。
        </p>
        <div className="mt-5 flex flex-col gap-5">
          <label className="flex flex-col gap-2">
            <span className="text-foreground text-sm font-medium">
              角色{" "}
              <span className="text-muted-foreground font-normal">
                （选填，默认"英语口语教练"）
              </span>
            </span>
            <input
              type="text"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="如：咖啡店店员"
              maxLength={24}
              className="bg-background focus:ring-(--scene-highlight) text-foreground placeholder:text-muted-foreground w-full rounded-2xl px-4 py-3 text-sm outline-none focus:ring-2"
            />
          </label>
          <label className="flex flex-col gap-2">
            <span className="text-foreground text-sm font-medium">场景（必填）</span>
            <input
              type="text"
              value={scenario}
              onChange={(e) => setScenario(e.target.value)}
              placeholder="如：在咖啡店用英语点单"
              maxLength={24}
              className="bg-background focus:ring-(--scene-highlight) text-foreground placeholder:text-muted-foreground w-full rounded-2xl px-4 py-3 text-sm outline-none focus:ring-2"
            />
          </label>
        </div>
      </div>

      {/* 确认按钮：场景为空时禁用 */}
      <div className="shrink-0 px-5 pt-2 pb-5">
        <button
          type="button"
          disabled={!canConfirm}
          onClick={() => onConfirm(role, scenario)}
          className={cn(
            "w-full rounded-full py-3 text-[15px] font-semibold shadow-md transition-[filter,opacity]",
            canConfirm
              ? "bg-(--scene-highlight) text-foreground hover:brightness-95"
              : "bg-(--scene-highlight)/50 text-foreground/50 cursor-not-allowed",
          )}
        >
          开始对话
        </button>
      </div>
    </>
  );
}

function SceneCard({
  entry,
  selected,
  onSelect,
}: {
  entry: SceneCatalogEntry;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "bg-background flex flex-col rounded-2xl px-4 pt-6 pb-5 text-left shadow-sm transition-shadow hover:shadow-md",
        selected && "ring-2 ring-(--icon-brand-green)",
      )}
    >
      {/* 大图标区：原型图为大号 emoji 置于浅灰圆形底上，占卡片上半部 */}
      <div className="flex h-28 w-full items-center justify-center">
        {entry.emoji ? (
          <span className="bg-muted flex size-24 items-center justify-center rounded-full">
            <span className="text-5xl leading-none">{entry.emoji}</span>
          </span>
        ) : (
          // 缺图标降级：占位圆形（spec 边界用例）
          <span className="bg-muted size-16 rounded-full" />
        )}
      </div>
      {/* 文字区：原型图左对齐，中文与英文两行同色黑 */}
      <span className="text-foreground mt-6 text-[15px] leading-snug font-medium">
        {entry.nameZh}
      </span>
      {entry.nameEn && (
        <span className="text-foreground mt-1.5 text-[15px] leading-snug">{entry.nameEn}</span>
      )}
    </button>
  );
}
