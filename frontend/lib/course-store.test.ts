import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CourseCatalog, LessonSnapshot, MistakeEntry } from "@/lib/course-types";

/**
 * course-store 单测（T028）：视图切换、课时快照落位（含续学）、完成后刷新目录。
 * 网络层被 mock，store 只验证状态机。
 */

vi.mock("@/lib/course-api", () => ({
  fetchCatalog: vi.fn(),
  fetchMistakes: vi.fn(),
  markMistake: vi.fn(),
  startLesson: vi.fn(),
  stepLesson: vi.fn(),
}));

import { fetchCatalog, fetchMistakes, markMistake, startLesson, stepLesson } from "@/lib/course-api";
import { useCourseStore } from "@/lib/course-store";

const mockedFetchCatalog = vi.mocked(fetchCatalog);
const mockedFetchMistakes = vi.mocked(fetchMistakes);
const mockedMarkMistake = vi.mocked(markMistake);
const mockedStartLesson = vi.mocked(startLesson);
const mockedStepLesson = vi.mocked(stepLesson);

const catalog: CourseCatalog = { categories: [], summary: { total_lessons: 3, completed_lessons: 0 } };

const snapshot = (overrides: Partial<LessonSnapshot> = {}): LessonSnapshot => ({
  session_id: "local:mood-today-l1:abcd1234",
  stage: "intro",
  payload: { target_sentence: "I'm in a really good mood today." },
  progress: {
    status: "in_progress",
    current_stage: "intro",
    completed_stages: [],
  },
  done: false,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  useCourseStore.setState({
    catalog: null,
    catalogState: "idle",
    catalogError: null,
    mistakes: [],
    mistakesSummary: null,
    mistakesState: "idle",
    mistakesError: null,
    view: "list",
    activeCourseId: null,
    activeLessonId: null,
    activeLessonName: null,
    sessionId: null,
    stage: null,
    payload: {},
    progress: null,
    lessonState: "idle",
    lessonError: null,
    submitting: false,
    done: false,
  });
});

describe("目录与视图", () => {
  it("loadCatalog 成功后进入 ready", async () => {
    mockedFetchCatalog.mockResolvedValue(catalog);
    await useCourseStore.getState().loadCatalog();

    const state = useCourseStore.getState();
    expect(state.catalogState).toBe("ready");
    expect(state.catalog).toEqual(catalog);
  });

  it("loadCatalog 失败时记录错误文案", async () => {
    mockedFetchCatalog.mockRejectedValue(new Error("后端未启动"));
    await useCourseStore.getState().loadCatalog();

    const state = useCourseStore.getState();
    expect(state.catalogState).toBe("error");
    expect(state.catalogError).toBe("后端未启动");
  });

  it("openCourse / backToList 切换视图并清理课时态", () => {
    useCourseStore.getState().openCourse("mood-today");
    expect(useCourseStore.getState().view).toBe("detail");
    expect(useCourseStore.getState().activeCourseId).toBe("mood-today");

    useCourseStore.setState({ sessionId: "s1", stage: "exercise" });
    useCourseStore.getState().backToList();

    const state = useCourseStore.getState();
    expect(state.view).toBe("list");
    expect(state.activeCourseId).toBeNull();
    expect(state.sessionId).toBeNull();
    expect(state.stage).toBeNull();
  });
});

describe("课时会话", () => {
  it("openLesson 直接把 fast-forward 后的 stage 落位（续学）", async () => {
    mockedStartLesson.mockResolvedValue(snapshot({ stage: "exercise", payload: { exercise_index: 1 } }));

    await useCourseStore.getState().openLesson("mood-today-l1", "心情不错");

    const state = useCourseStore.getState();
    expect(state.view).toBe("lesson");
    expect(state.activeLessonId).toBe("mood-today-l1");
    expect(state.activeLessonName).toBe("心情不错");
    expect(state.lessonState).toBe("ready");
    expect(state.stage).toBe("exercise");
    expect(state.payload).toEqual({ exercise_index: 1 });
    expect(state.sessionId).toBe("local:mood-today-l1:abcd1234");
  });

  it("openLesson 失败时进入 error 态", async () => {
    mockedStartLesson.mockRejectedValue(new Error("lesson not found"));
    await useCourseStore.getState().openLesson("missing");

    const state = useCourseStore.getState();
    expect(state.lessonState).toBe("error");
    expect(state.lessonError).toBe("lesson not found");
  });

  it("submit 推进 stage，并在 done 时置位", async () => {
    useCourseStore.setState({ sessionId: "local:mood-today-l1:abcd1234", stage: "intro" });
    mockedStepLesson.mockResolvedValue(snapshot({ stage: "knowledge", payload: { points: [] } }));

    await useCourseStore.getState().submit("I'm in a really good mood today.");

    const state = useCourseStore.getState();
    expect(mockedStepLesson).toHaveBeenCalledWith("local:mood-today-l1:abcd1234", "I'm in a really good mood today.");
    expect(state.stage).toBe("knowledge");
    expect(state.submitting).toBe(false);
  });

  it("无 session 时 submit 不发请求", async () => {
    await useCourseStore.getState().submit("hi");
    expect(mockedStepLesson).not.toHaveBeenCalled();
  });

  it("完成课时后回到详情并刷新目录", async () => {
    mockedFetchCatalog.mockResolvedValue(catalog);
    useCourseStore.setState({ view: "lesson", stage: "completed", done: true });

    await useCourseStore.getState().finishLesson();

    const state = useCourseStore.getState();
    expect(state.view).toBe("detail");
    expect(state.stage).toBeNull();
    expect(state.done).toBe(false);
    expect(mockedFetchCatalog).toHaveBeenCalledTimes(1);
  });
});

const mistake = (overrides: Partial<MistakeEntry> = {}): MistakeEntry => ({
  id: "mood-today-l1::mood-today-l1-ex1",
  lesson_id: "mood-today-l1",
  lesson_name: "1-1 说出我的好心情",
  course_id: "mood-today",
  course_name: "今天我心情特别好",
  exercise_id: "mood-today-l1-ex1",
  question: "你想说「我今天心情特别好」，用刚学的表达怎么说？",
  reference_answer: "I'm in a really good mood today.",
  user_answer: "I am happy.",
  verdict: "incorrect",
  feedback: "对照原句再试一次",
  suggested: "",
  wrong_count: 1,
  status: "pending" as const,
  created_at: "2026-11-09T10:00:00+08:00",
  updated_at: "2026-11-09T10:00:00+08:00",
  mastered_at: null,
  ...overrides,
});

describe("错题本", () => {
  it("openMistakes 切到错题本视图并加载列表", async () => {
    mockedFetchMistakes.mockResolvedValue({
      mistakes: [mistake()],
      summary: { total: 1, pending: 1, mastered: 0 },
    });

    await useCourseStore.getState().openMistakes();

    const state = useCourseStore.getState();
    expect(state.view).toBe("mistakes");
    expect(state.mistakesState).toBe("ready");
    expect(state.mistakes).toHaveLength(1);
    expect(state.mistakesSummary).toEqual({ total: 1, pending: 1, mastered: 0 });
  });

  it("openMistakes 加载失败时进入 error 态", async () => {
    mockedFetchMistakes.mockRejectedValue(new Error("network down"));

    await useCourseStore.getState().openMistakes();

    const state = useCourseStore.getState();
    expect(state.mistakesState).toBe("error");
    expect(state.mistakesError).toBe("network down");
  });

  it("setMistakeMastered 用接口返回更新单条与统计", async () => {
    useCourseStore.setState({
      mistakes: [mistake()],
      mistakesSummary: { total: 1, pending: 1, mastered: 0 },
    });
    mockedMarkMistake.mockResolvedValue({
      mistake: mistake({ status: "mastered", mastered_at: "2026-11-09T11:00:00+08:00" }),
      summary: { total: 1, pending: 0, mastered: 1 },
    });

    await useCourseStore.getState().setMistakeMastered(mistake().id, true);

    const state = useCourseStore.getState();
    expect(mockedMarkMistake).toHaveBeenCalledWith(mistake().id, true);
    expect(state.mistakes[0].status).toBe("mastered");
    expect(state.mistakesSummary).toEqual({ total: 1, pending: 0, mastered: 1 });
  });

  it("setMistakeMastered 失败只记录错误、不清空列表", async () => {
    useCourseStore.setState({
      mistakes: [mistake()],
      mistakesSummary: { total: 1, pending: 1, mastered: 0 },
    });
    mockedMarkMistake.mockRejectedValue(new Error("mark failed"));

    await useCourseStore.getState().setMistakeMastered(mistake().id, true);

    const state = useCourseStore.getState();
    expect(state.mistakes).toHaveLength(1);
    expect(state.mistakesError).toBe("mark failed");
  });

  it("closeMistakes 回到列表视图", () => {
    useCourseStore.setState({ view: "mistakes" });
    useCourseStore.getState().closeMistakes();
    expect(useCourseStore.getState().view).toBe("list");
  });
});
