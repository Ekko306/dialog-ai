/**
 * 场景目录静态数据（FR-011，契约：specs/002-scene-select-popup/contracts/scene-catalog.md）：
 * 弹窗分类栏与话题卡片的唯一数据源，纯常量、无请求；用户可随时替换。
 * 约束：条目 id 目录内唯一；nameZh 非空；nameEn 可缺省（缺省只显示中文）；
 * 默认 role="英语口语教练"、scenario=nameZh；role/scenario 不得含 "::"（指令分隔符）。
 */

export type CategoryId = "hot" | "today" | "daily" | "travel" | "career";

export interface SceneCategory {
  id: CategoryId;
  label: string; // 分类胶囊文案
  order: number; // 展示排序（原型图从左到右）
}

export interface SceneCatalogEntry {
  id: string; // 目录内唯一，React key
  category: CategoryId;
  emoji: string; // 卡片图标（渲染失败降级占位圆形）
  nameZh: string; // 中文话题名（非空）
  nameEn?: string; // 英文名（可缺省）
  role: string; // 映射的后端角色（写入 CoachContext.role）
  scenario: string; // 映射的后端场景（写入 CoachContext.scenario）
}

export const SCENE_CATEGORIES: SceneCategory[] = [
  { id: "hot", label: "热门", order: 1 },
  { id: "today", label: "今日话题", order: 2 },
  { id: "daily", label: "日常交流", order: 3 },
  { id: "travel", label: "旅游出行", order: 4 },
  { id: "career", label: "职场", order: 5 },
];

/** 原型图可见 6 项（精确对齐）+ 其余分类按主题拟定（3~4 项/分类，可随时替换） */
export const SCENE_CATALOG: SceneCatalogEntry[] = [
  // ---- 今日话题 ----
  {
    id: "black-monday",
    category: "today",
    emoji: "🎒",
    nameZh: "黑色星期一",
    nameEn: "Black Monday",
    role: "英语口语教练",
    scenario: "黑色星期一",
  },
  {
    id: "weather-weekend",
    category: "today",
    emoji: "⛅",
    nameZh: "天气与周末计划",
    nameEn: "Weather & weekend plans",
    role: "英语口语教练",
    scenario: "天气与周末计划",
  },
  {
    id: "tv-shows",
    category: "today",
    emoji: "🎬",
    nameZh: "最近看的剧",
    nameEn: "TV shows lately",
    role: "英语口语教练",
    scenario: "最近看的剧",
  },
  {
    id: "news-highlights",
    category: "today",
    emoji: "📰",
    nameZh: "新闻热点",
    nameEn: "News highlights",
    role: "英语口语教练",
    scenario: "新闻热点",
  },

  // ---- 日常交流 ----
  {
    id: "hobby",
    category: "daily",
    emoji: "✨",
    nameZh: "爱好",
    nameEn: "hobby",
    role: "英语口语教练",
    scenario: "爱好",
  },
  {
    id: "afternoon-tea",
    category: "daily",
    emoji: "🥞",
    nameZh: "点下午茶",
    nameEn: "Order afternoon tea",
    role: "英语口语教练",
    scenario: "点下午茶",
  },
  {
    id: "ordering-food",
    category: "daily",
    emoji: "🍜",
    nameZh: "点餐",
    nameEn: "Ordering food",
    role: "英语口语教练",
    scenario: "点餐",
  },
  {
    id: "shopping-bargains",
    category: "daily",
    emoji: "🛍️",
    nameZh: "购物砍价",
    nameEn: "Shopping bargains",
    role: "英语口语教练",
    scenario: "购物砍价",
  },
  {
    id: "seeing-doctor",
    category: "daily",
    emoji: "🩺",
    nameZh: "看医生",
    nameEn: "Seeing a doctor",
    role: "英语口语教练",
    scenario: "看医生",
  },
  {
    id: "phone-call",
    category: "daily",
    emoji: "📞",
    nameZh: "打电话",
    nameEn: "Making a phone call",
    role: "英语口语教练",
    scenario: "打电话",
  },

  // ---- 旅游出行 ----
  {
    id: "check-in",
    category: "travel",
    emoji: "✈️",
    nameZh: "办理登机",
    nameEn: "Check in",
    role: "英语口语教练",
    scenario: "办理登机",
  },
  {
    id: "asking-directions",
    category: "travel",
    emoji: "🛣️",
    nameZh: "问路",
    nameEn: "Asking for directions",
    role: "英语口语教练",
    scenario: "问路",
  },
  {
    id: "hotel-check-in",
    category: "travel",
    emoji: "🏨",
    nameZh: "酒店入住",
    nameEn: "Hotel check-in",
    role: "英语口语教练",
    scenario: "酒店入住",
  },
  {
    id: "returns-refunds",
    category: "travel",
    emoji: "📦",
    nameZh: "退换货",
    nameEn: "Returns and refunds",
    role: "英语口语教练",
    scenario: "退换货",
  },

  // ---- 职场 ----
  {
    id: "job-interview",
    category: "career",
    emoji: "💻",
    nameZh: "求职面试",
    nameEn: "Job Interview",
    role: "英语口语教练",
    scenario: "求职面试",
  },
  {
    id: "business-meeting",
    category: "career",
    emoji: "💼",
    nameZh: "职场会议",
    nameEn: "Business meeting",
    role: "商务英语教练",
    scenario: "职场会议",
  },
  {
    id: "self-introduction",
    category: "career",
    emoji: "🙋",
    nameZh: "自我介绍",
    nameEn: "Self introduction",
    role: "英语口语教练",
    scenario: "自我介绍",
  },
  {
    id: "reporting-progress",
    category: "career",
    emoji: "📊",
    nameZh: "汇报进度",
    nameEn: "Reporting progress",
    role: "英语口语教练",
    scenario: "汇报进度",
  },
];

/** 热门分类 = 原型图可见 6 项（引用同一批条目对象，不复制数据） */
export const HOT_CATEGORY_IDS = [
  "hobby",
  "job-interview",
  "check-in",
  "asking-directions",
  "afternoon-tea",
  "black-monday",
] as const;

/** 取指定分类下的条目（hot 为精选子集）；目录数据异常时返回空数组由弹窗空态兜底 */
export function getEntriesByCategory(category: CategoryId): SceneCatalogEntry[] {
  if (category === "hot") {
    return HOT_CATEGORY_IDS.map((id) => SCENE_CATALOG.find((entry) => entry.id === id)).filter(
      (entry): entry is SceneCatalogEntry => entry != null,
    );
  }
  return SCENE_CATALOG.filter((entry) => entry.category === category);
}
