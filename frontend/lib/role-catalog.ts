/**
 * 角色目录静态数据（003 FR-003/FR-006，契约：specs/003-switch-conversation-role/contracts/role-catalog.md）：
 * 消息页会话列表与角色对话页的唯一数据源，纯常量、无请求、零副作用；用户可随时替换。
 * 约束（contract §4 不变量）：id 全局唯一且稳定（路由/存储 key，发布后不得更改）；
 * opening 非空；openingSuggestions 0~2 条且 label 非空；alicia 恒存在且 MAIN_ROLE_ID 指向它
 * （消息列表照常展示，点击 = 返回主对话视图，不创建角色实例）。
 * lisa 开场白 = spec FR-006 原文，不得改动。
 * 原型图：frontend/docs/mockups/子功能-切换对话role.png（图2 列表预览、图3 角色页）。
 */

export interface RoleOpeningSuggestion {
  label: string; // 语域风格标签，如 "简单" / "商务"
  text: string; // 回复内容（点击后作为用户消息原文发送）
}

export type RoleAvatar =
  | { kind: "image"; src: string } // public/ 下图片路径
  | { kind: "initial"; char: string; colorClass: string }; // 首字母圆形（Tailwind 色类）

export interface RoleCatalogEntry {
  id: string; // 稳定标识，路由/存储 key
  name: string; // 角色名称（FR-003 清单原文）
  avatar: RoleAvatar;
  tagline: string; // 身份介绍一句话
  opening: string; // 预置开场白（FR-006，配置数据非现场生成）
  openingSuggestions: RoleOpeningSuggestion[]; // 首轮推荐回复，0~2 条
}

/** 主对话身份的 roleId：消息页点击它 = 返回主对话视图（research R1/R2） */
export const MAIN_ROLE_ID = "alicia";

export const ROLE_CATALOG: RoleCatalogEntry[] = [
  {
    id: "alicia",
    // 2026-10-26 用户指令：英文名互换而头衔随身份保留——alicia（助教身份）取名 Ella
    // 与主对话页顶栏"Ella"一致；ella（零基础外教身份）取名 Alicia。
    // id/主线程语义/头像/开场白均不动
    name: "TalkAI助教Ella",
    avatar: { kind: "image", src: "/roles/alicia.jpg" },
    tagline: "你的个性化语言学习助手",
    // 主对话身份：opening 不用于角色页 Welcome，仅作消息列表空态预览摘要
    opening:
      "你好呀～我是你的个性化语言学习助手。你可以和我自由练英语，我会帮你纠错、润色，陪你一起进步。",
    openingSuggestions: [],
  },
  {
    id: "lisa",
    name: "英语纠错官Lisa",
    avatar: { kind: "image", src: "/roles/lisa.jpg" },
    tagline: "中文纠错润色，英语维持对话",
    // spec FR-006 原文，不得改动
    opening:
      "Hi, 我是Lisa。我会用中文对你发出的英语进行纠错及润色，再用英语维持对话，我们开始吧！What's new today?",
    openingSuggestions: [
      { label: "简单", text: "Not much. I've just been busy with work lately." },
      { label: "商务", text: "I spent the whole week preparing the quarterly report." },
    ],
  },
  {
    id: "ella",
    name: "英语零基础外教Alicia",
    avatar: { kind: "image", src: "/roles/ella.jpg" },
    tagline: "从零开始，轻松开口说英语",
    opening:
      "Are you tired today? Take it easy — let's chat slowly in English. Tell me about your day!",
    openingSuggestions: [
      { label: "简单", text: "Yes, a little tired. I just finished work." },
      { label: "商务", text: "I'm preparing for a meeting tomorrow." },
    ],
  },
  {
    id: "sally",
    name: "全英纠错官Sally",
    avatar: { kind: "image", src: "/roles/sally.jpg" },
    tagline: "全英语境纠错，大胆说就好",
    opening:
      "Hi, I'm Sally! 👋 Let's chat in English. Don't be afraid of mistakes — I'll correct them and help you improve.",
    openingSuggestions: [
      { label: "简单", text: "Hi Sally! I watched a movie yesterday." },
      { label: "商务", text: "I attended a team meeting this morning." },
    ],
  },
  {
    id: "mira",
    name: "AI外教Mira",
    avatar: { kind: "image", src: "/roles/mira.jpg" },
    tagline: "轻松聊天，边玩边学",
    // 图2 预览原文起始
    opening: "Hey! I'm Mira. ✌️ Ready to relax and have fun while learning English?",
    openingSuggestions: [
      { label: "简单", text: "Hey Mira! I just relaxed at home today." },
      { label: "商务", text: "I've been working on a client presentation." },
    ],
  },
  {
    id: "zora",
    name: "传译官Zora",
    avatar: { kind: "image", src: "/roles/zora.jpg" },
    tagline: "中英互译，自由切换",
    // 图2 预览原文起始
    opening: "你的专属传译官已上线！把你想说的话发给我，我帮你在中英文之间自由切换。",
    openingSuggestions: [
      { label: "简单", text: "我想说：今天天气很好，心情也不错。" },
      { label: "商务", text: "我想说：感谢各位的到来，请这边坐。" },
    ],
  },
  {
    id: "david",
    name: "AI外教David",
    avatar: { kind: "image", src: "/roles/david.jpg" },
    tagline: "耐心陪练，地道表达",
    // 图2 预览原文补全
    opening:
      "Hello there! I'm so glad to meet you. I'm your English teacher David — let's have a great conversation today!",
    openingSuggestions: [
      { label: "简单", text: "Hello David! Nice to meet you. I'm doing great." },
      { label: "商务", text: "Good morning David. I have a busy schedule today." },
    ],
  },
  {
    id: "dylan",
    name: "雅思考官Dylan",
    avatar: { kind: "image", src: "/roles/dylan.jpg" },
    tagline: "雅思口语实战模拟",
    opening:
      "Hello, I'm Dylan, your IELTS examiner. Ready to practice? Let's start with Part 1 — tell me about your hometown.",
    openingSuggestions: [
      { label: "简单", text: "I'm ready. My hometown is a small city in the south." },
      { label: "商务", text: "I'd like to practice Part 3 about work and careers." },
    ],
  },
  {
    id: "luke",
    name: "每日俚语分享官Luke",
    avatar: { kind: "image", src: "/roles/luke.jpg" },
    tagline: "每天一个地道俚语",
    // 图2 预览原文补全
    opening:
      "Yo, it's Luke here! What's the specific situation you want to talk about? Tell me and I'll share today's slang!",
    openingSuggestions: [
      { label: "简单", text: "Yo Luke! Nothing much, just chilling at home." },
      { label: "商务", text: "We closed the deal yesterday. I'm pumped!" },
    ],
  },
  {
    id: "fiona",
    name: "Fiona",
    avatar: { kind: "image", src: "/roles/fiona.jpg" },
    tagline: "陪你轻松聊英语的伙伴",
    opening: "Hi, I'm Fiona! What did you do today? Tell me all about it in English.",
    openingSuggestions: [
      { label: "简单", text: "Hi Fiona! Today was pretty good. How about you?" },
      { label: "商务", text: "I had three meetings today and I'm a bit tired." },
    ],
  },
  {
    id: "piper",
    name: "Piper带你学短语固定搭配",
    avatar: { kind: "image", src: "/roles/piper.jpg" },
    tagline: "短语搭配，地道积累",
    opening:
      "Hi, I'm Piper! 今天想积累哪类英语短语搭配？日常、职场还是旅行？告诉我，我们一起学地道表达。",
    openingSuggestions: [
      { label: "简单", text: "我想学日常交流常用的短语。" },
      { label: "商务", text: "我想学职场邮件常用的搭配。" },
    ],
  },
  {
    id: "sarah",
    name: "词根词缀记单词Sarah",
    avatar: { kind: "image", src: "/roles/sarah.jpg" },
    tagline: "词根词缀，科学背词",
    opening:
      "Hi, I'm Sarah! 背单词不用死记硬背，跟我用词根词缀拆解单词，记得又快又牢。今天想从哪个词根开始？",
    openingSuggestions: [
      { label: "简单", text: "我想用词根词缀记日常单词。" },
      { label: "商务", text: "帮我拆解 suggest 和 inspect 这类词。" },
    ],
  },
];

/** 取指定角色条目；目录数据异常时返回 undefined（消费方按 FR-011 空态兜底） */
export function getRole(id: string): RoleCatalogEntry | undefined {
  return ROLE_CATALOG.find((entry) => entry.id === id);
}
