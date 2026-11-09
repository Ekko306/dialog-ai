import type {
  CourseCatalog,
  LessonSnapshot,
  MistakeEntry,
  MistakesSnapshot,
  MistakeSummary,
  ProgressSnapshot,
} from "@/lib/course-types";

/**
 * 精品课 HTTP 封装（specs/005-premium-course/contracts/）：
 * 统一走 Next 的 `/api` 代理（app/api/[..._path]/route.ts → LANGGRAPH_API_URL），
 * 非 2xx 抛 `CourseApiError`（带 status 与后端 detail），由页面统一展示。
 */

export class CourseApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "CourseApiError";
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new CourseApiError("网络异常，请检查后端是否启动", 0);
  }

  if (!res.ok) {
    let detail = `请求失败（${res.status}）`;
    try {
      const body = (await res.json()) as { detail?: unknown; error?: unknown };
      const message = body.detail ?? body.error;
      if (typeof message === "string" && message.trim()) detail = message;
    } catch {
      // 非 JSON 错误体：保留默认文案
    }
    throw new CourseApiError(detail, res.status);
  }

  return (await res.json()) as T;
}

const jsonInit = (payload: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(payload),
});

/** 课程目录 + 完成进度（一次返回） */
export const fetchCatalog = (): Promise<CourseCatalog> => request<CourseCatalog>("/api/course/catalog");

/** 学习进度全量快照 */
export const fetchProgress = (): Promise<ProgressSnapshot> =>
  request<ProgressSnapshot>("/api/course/progress");

/** 开始课时：返回首个环节快照（后端按进度快进，§3 续学） */
export const startLesson = (lessonId: string): Promise<LessonSnapshot> =>
  request<LessonSnapshot>("/api/course/lesson/start", jsonInit({ lesson_id: lessonId }));

/** 推进一步：以用户输入 resume 图，返回下一环节快照或完成态 */
export const stepLesson = (sessionId: string, input: string): Promise<LessonSnapshot> =>
  request<LessonSnapshot>("/api/course/lesson/step", jsonInit({ session_id: sessionId, input }));

/** 错题本列表 + 统计（答错时后端自动记录） */
export const fetchMistakes = (): Promise<MistakesSnapshot> =>
  request<MistakesSnapshot>("/api/course/mistakes");

/** 标记错题已掌握 / 重新加入待复习 */
export const markMistake = (
  id: string,
  mastered: boolean,
): Promise<{ mistake: MistakeEntry; summary: MistakeSummary }> =>
  request<{ mistake: MistakeEntry; summary: MistakeSummary }>(
    "/api/course/mistakes/mark",
    jsonInit({ id, mastered }),
  );
