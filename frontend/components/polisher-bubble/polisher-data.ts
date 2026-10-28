/**
 * 润色气泡数据基建（005 T004，data-model.md 契约）：
 * PolisherMessageData 消费结构 + parsePolisherData 容错守卫 +
 * shouldRenderPolisher 渲染守卫（contract §3，FR-009）+ 会话级缓存。
 * 缓存模式与 003 correctionCache 同款：值关联只覆盖最新一轮，
 * 缓存让历史气泡在本次会话内持续展示，刷新自然失效。
 */

/** 005 契约：后端 additional_kwargs["metadata"]["polisher_data"] 透传结构 */
export interface PolisherMessageData {
  raw_text: string; // 原句（后端 original_text）：原句行渲染 + 翻译输入 + raw 发音输入
  polished_text: string; // 润色句：建议行渲染 + 复制/跟读/correct 发音输入
  explanation: string; // 中文解释：本期不展示，字段保留（spec Assumptions）
  polish_status: string; // success | fallback | skipped（后端 polisher_nodes.py 实际枚举）
}

/**
 * 字段容错守卫（FR-009：缺失/反序列化失败一律走普通气泡，不报错）。
 * raw_text 与 polished_text 是渲染必需；explanation/polish_status 允许缺省。
 *
 * raw_text 双来源（T017 验收修复，003 字段名教训同款）：
 * - metadata 透传：talk_graph.py 已把 original_text 映射为 raw_text；
 * - state 兜底（流式主路径）：拿到的是 polisher 字典原始字段 original_text
 *   （state.py PolisherOutput 契约），必须在此完成映射，否则流式下
 *   metadata 被 SDK 丢弃 + state 解析失败 → 气泡永远不渲染。
 */
export function parsePolisherData(value: unknown): PolisherMessageData | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const rawText = typeof v.raw_text === "string" ? v.raw_text : v.original_text;
  if (typeof rawText !== "string" || typeof v.polished_text !== "string") return null;
  return {
    raw_text: rawText,
    polished_text: v.polished_text,
    explanation: typeof v.explanation === "string" ? v.explanation : "",
    polish_status: typeof v.polish_status === "string" ? v.polish_status : "",
  };
}

/**
 * 渲染守卫三条件（contract §3，全部满足才渲染润色气泡）：
 * 1. polished_text 非空；2. ≠ raw_text（fallback 保留原文场景）；
 * 3. polish_status ≠ "skipped"（无英文内容场景）。
 */
export function shouldRenderPolisher(data: PolisherMessageData): boolean {
  return (
    data.polished_text.trim() !== "" &&
    data.polished_text.trim() !== data.raw_text.trim() &&
    data.polish_status !== "skipped"
  );
}

const polisherCache = new Map<string, PolisherMessageData>();

export function getCachedPolisher(messageId: string): PolisherMessageData | undefined {
  return polisherCache.get(messageId);
}

export function setCachedPolisher(messageId: string, data: PolisherMessageData): void {
  polisherCache.set(messageId, data);
}
