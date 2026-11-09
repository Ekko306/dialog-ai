/**
 * 精品课数据契约（与 specs/005-premium-course/contracts/ 对齐）：
 * - course-catalog.md：`GET /course/catalog` 响应
 * - lesson-session.md：`POST /course/lesson/start` / `step` 响应
 *
 * 只做类型描述；请求封装见 `course-api.ts`，UI 状态见 `course-store.ts`。
 */

// ========== 目录（course-catalog.md §1） ==========

export type LessonStatus = "not_started" | "in_progress" | "completed";

export interface LessonBrief {
  id: string;
  name: string;
  order: number;
  status: LessonStatus;
}

export interface Chapter {
  id: string;
  name: string;
  order: number;
  lessons: LessonBrief[];
}

export interface Course {
  id: string;
  name: string;
  description: string;
  /** 卡片主色：green / blue / orange（数据侧预置，前端仅做色板映射） */
  cover_color: string;
  order: number;
  lesson_count: number;
  completed_count: number;
  chapters: Chapter[];
}

export interface CourseCategory {
  id: string;
  name: string;
  order: number;
  courses: Course[];
}

export interface CatalogSummary {
  total_lessons: number;
  completed_lessons: number;
}

export interface CourseCatalog {
  categories: CourseCategory[];
  summary: CatalogSummary;
}

// ========== 进度（lesson-session.md §3） ==========

export interface RoleplayTurn {
  role: "user" | "assistant";
  text: string;
  evaluation: EvaluationResult | null;
}

export interface LessonProgress {
  status: LessonStatus;
  current_stage: string;
  completed_stages: string[];
  retry_counts?: Record<string, number>;
  started_at?: string | null;
  completed_at?: string | null;
  answered?: Record<string, string>;
  roleplay_transcript?: RoleplayTurn[];
}

export interface ProgressSnapshot {
  version: number;
  updated_at: string | null;
  lessons: Record<string, LessonProgress>;
}

// ========== 错题本 ==========

/** 错题状态：pending=待复习，mastered=已掌握 */
export type MistakeStatus = "pending" | "mastered";

export interface MistakeEntry {
  /** 稳定主键：`<lesson_id>::<exercise_id>` */
  id: string;
  lesson_id: string;
  lesson_name: string;
  course_id: string;
  course_name: string;
  exercise_id: string;
  question: string;
  reference_answer: string;
  user_answer: string;
  verdict: string;
  feedback: string;
  suggested: string;
  wrong_count: number;
  status: MistakeStatus;
  created_at: string;
  updated_at: string;
  mastered_at: string | null;
}

export interface MistakeSummary {
  total: number;
  pending: number;
  mastered: number;
}

export interface MistakesSnapshot {
  mistakes: MistakeEntry[];
  summary: MistakeSummary;
}

// ========== 课时会话（lesson-session.md §1/§2） ==========

export interface EvaluationResult {
  verdict: "correct" | "acceptable" | "incorrect";
  feedback: string;
  suggested: string;
  /** 下一步引导（知识点环节的 AI 导师点评会带） */
  hint?: string;
}

export interface IntroPayload {
  lesson_name: string;
  scene: string;
  target_sentence: string;
  tts_text: string;
  attempts: number;
  max_attempts: number;
  feedback: string | null;
  hint: string;
}

export interface KnowledgePoint {
  title: string;
  explanation: string;
  example: string;
}

export interface KnowledgePayload {
  points: KnowledgePoint[];
  /** AI 主动提出的问题（要求用本课表达作答） */
  question?: string | null;
  /** AI 给出的思路引导（不直接给答案） */
  hint?: string | null;
  attempts?: number;
  /** 学习者作答后 AI 的点评与引导（needs_confirm 为 true 时带） */
  result?: EvaluationResult | null;
  needs_confirm?: boolean;
}

export interface ExercisePayload {
  exercise_index: number;
  exercise_total: number;
  question: string;
  attempts: number;
  max_attempts: number;
  /** 上一次作答的评价（答错重试时才带） */
  result: EvaluationResult | null;
  /** 达到上限 / 作答通过后的收尾态才带参考答案与 needs_confirm */
  reference_answer?: string | null;
  needs_confirm?: boolean;
  degraded?: boolean;
  /** 用户主动请求的分层提示 */
  hint?: string | null;
}

export interface RoleplayPayload {
  role: string;
  setting: string;
  goal: string;
  round: number;
  max_rounds: number;
  ai_message: string;
  /** 上一轮用户发言的评价 */
  evaluation: EvaluationResult | null;
  /** 用户主动请求的回应提示 */
  hint?: string | null;
}

export interface SummaryScores {
  intro: string;
  exercise: string;
  roleplay_rounds: number;
}

export interface SummaryPayload {
  summary: string;
  suggestions: string[];
  scores: SummaryScores;
  degraded: boolean;
}

export type LessonStage = "intro" | "knowledge" | "exercise" | "roleplay" | "summary" | "completed";

/** 环节 payload 判别用：按 stage 收窄类型，组件内做一次断言即可 */
export interface LessonPayloadMap {
  intro: IntroPayload;
  knowledge: KnowledgePayload;
  exercise: ExercisePayload;
  roleplay: RoleplayPayload;
  summary: SummaryPayload;
}

export interface LessonSnapshot {
  session_id: string;
  stage: LessonStage;
  payload: Record<string, unknown>;
  progress: LessonProgress | Record<string, never>;
  done: boolean;
}
