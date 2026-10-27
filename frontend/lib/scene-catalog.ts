/**
 * 场景目录静态数据（FR-011，契约：specs/002-scene-select-popup/contracts/scene-catalog.md）：
 * 弹窗分类栏与话题卡片的唯一数据源，纯常量、无请求；用户可随时替换。
 * 约束：条目 id 目录内唯一；nameZh 非空；nameEn 可缺省（缺省只显示中文）；
 * 默认 role="英语口语教练"、scenario=nameZh；role/scenario 不得含 "::"（指令分隔符）。
 */

export type CategoryId =
  | "hot"
  | "today"
  | "daily"
  | "travel"
  | "career"
  | "study"
  | "social"
  | "campus"
  | "culture";

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
  { id: "study", label: "学习提升", order: 6 },
  { id: "social", label: "社交聚会", order: 7 },
  { id: "campus", label: "留学校园", order: 8 },
  { id: "culture", label: "文化娱乐", order: 9 },
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

  // ---- 学习提升 ----
  {
    id: "memorize-words",
    category: "study",
    emoji: "📚",
    nameZh: "背单词",
    nameEn: "Memorizing words",
    role: "英语口语教练",
    scenario: "背单词",
  },
  {
    id: "english-speech",
    category: "study",
    emoji: "🎤",
    nameZh: "英语演讲",
    nameEn: "English speech practice",
    role: "英语口语教练",
    scenario: "英语演讲练习",
  },
  {
    id: "speaking-test",
    category: "study",
    emoji: "📝",
    nameZh: "口语考试",
    nameEn: "Speaking test prep",
    role: "英语口语教练",
    scenario: "口语考试准备",
  },
  {
    id: "learn-from-shows",
    category: "study",
    emoji: "📺",
    nameZh: "看美剧学英语",
    nameEn: "Learning English from TV shows",
    role: "英语口语教练",
    scenario: "看美剧学英语",
  },

  // ---- 社交聚会 ----
  {
    id: "friends-party",
    category: "social",
    emoji: "🎉",
    nameZh: "朋友聚会",
    nameEn: "At a party",
    role: "英语口语教练",
    scenario: "朋友聚会",
  },
  {
    id: "meeting-people",
    category: "social",
    emoji: "🤝",
    nameZh: "认识新朋友",
    nameEn: "Meeting new people",
    role: "英语口语教练",
    scenario: "认识新朋友",
  },
  {
    id: "small-talk",
    category: "social",
    emoji: "☕",
    nameZh: "闲聊寒暄",
    nameEn: "Small talk",
    role: "英语口语教练",
    scenario: "闲聊寒暄",
  },
  {
    id: "choosing-gift",
    category: "social",
    emoji: "🎁",
    nameZh: "挑选礼物",
    nameEn: "Choosing a gift",
    role: "英语口语教练",
    scenario: "挑选礼物",
  },

  // ---- 留学校园 ----
  {
    id: "class-discussion",
    category: "campus",
    emoji: "🏫",
    nameZh: "课堂讨论",
    nameEn: "Class discussion",
    role: "英语口语教练",
    scenario: "课堂讨论",
  },
  {
    id: "library",
    category: "campus",
    emoji: "📖",
    nameZh: "图书馆借书",
    nameEn: "At the library",
    role: "英语口语教练",
    scenario: "图书馆借书",
  },
  {
    id: "club-activities",
    category: "campus",
    emoji: "🎭",
    nameZh: "社团活动",
    nameEn: "Club activities",
    role: "英语口语教练",
    scenario: "社团活动",
  },
  {
    id: "dorm-life",
    category: "campus",
    emoji: "🏠",
    nameZh: "宿舍生活",
    nameEn: "Dorm life",
    role: "英语口语教练",
    scenario: "宿舍生活",
  },

  // ---- 文化娱乐 ----
  {
    id: "about-music",
    category: "culture",
    emoji: "🎵",
    nameZh: "聊音乐",
    nameEn: "Talking about music",
    role: "英语口语教练",
    scenario: "聊音乐",
  },
  {
    id: "about-movies",
    category: "culture",
    emoji: "🎥",
    nameZh: "聊电影",
    nameEn: "Talking about movies",
    role: "英语口语教练",
    scenario: "聊电影",
  },
  {
    id: "about-games",
    category: "culture",
    emoji: "🎮",
    nameZh: "聊游戏",
    nameEn: "Talking about video games",
    role: "英语口语教练",
    scenario: "聊游戏",
  },
  {
    id: "about-celebrities",
    category: "culture",
    emoji: "⭐",
    nameZh: "聊偶像",
    nameEn: "Talking about celebrities",
    role: "英语口语教练",
    scenario: "聊偶像",
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
