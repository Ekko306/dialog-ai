/** 空占位页（FR-003）：仅居中提示文字，无插画、无交互元素，tab2/tab3 复用 */
export function EmptyTab() {
  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-sm text-muted-foreground">功能建设中</p>
    </div>
  );
}
