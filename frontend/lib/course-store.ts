"use client";

import { create } from "zustand";

import {
  fetchCatalog,
  fetchMistakes,
  markMistake as markMistakeApi,
  startLesson,
  stepLesson,
} from "@/lib/course-api";
import type {
  CourseCatalog,
  LessonProgress,
  LessonStage,
  MistakeEntry,
  MistakeSummary,
} from "@/lib/course-types";

/**
 * 精品课页面状态（data-model.md §5，US1/US2/US3）：
 * - 视图机：list（课程列表）→ detail（章节/课时）→ lesson（全屏学习页）；
 * - 目录与学习进度都由后端 `/course/*` 返回，前端不缓存写侧真值；
 * - `openLesson` 直接用 startLesson 的返回落到对应 stage —— 后端已按
 *   progress.json 快进，天然支持断点续学（FR-015，T025）。
 */

export type CourseView = "list" | "detail" | "lesson" | "mistakes";
export type LoadState = "idle" | "loading" | "ready" | "error";

interface CourseUiState {
  catalog: CourseCatalog | null;
  catalogState: LoadState;
  catalogError: string | null;

  mistakes: MistakeEntry[];
  mistakesSummary: MistakeSummary | null;
  mistakesState: LoadState;
  mistakesError: string | null;

  view: CourseView;
  activeCourseId: string | null;
  activeLessonId: string | null;
  activeLessonName: string | null;

  sessionId: string | null;
  stage: LessonStage | null;
  payload: Record<string, unknown>;
  progress: LessonProgress | null;
  lessonState: LoadState;
  lessonError: string | null;
  submitting: boolean;
  done: boolean;

  loadCatalog: () => Promise<void>;
  loadMistakes: () => Promise<void>;
  openMistakes: () => Promise<void>;
  closeMistakes: () => void;
  setMistakeMastered: (id: string, mastered: boolean) => Promise<void>;
  openCourse: (courseId: string) => void;
  backToList: () => void;
  openLesson: (lessonId: string, lessonName?: string) => Promise<void>;
  submit: (input: string) => Promise<void>;
  finishLesson: () => Promise<void>;
  backToDetail: () => void;
}

const errorText = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message ? error.message : fallback;

export const useCourseStore = create<CourseUiState>((set, get) => ({
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

  loadCatalog: async () => {
    set({ catalogState: "loading", catalogError: null });
    try {
      const catalog = await fetchCatalog();
      set({ catalog, catalogState: "ready" });
    } catch (error) {
      set({ catalogState: "error", catalogError: errorText(error, "课程加载失败") });
    }
  },

  loadMistakes: async () => {
    set({ mistakesState: "loading", mistakesError: null });
    try {
      const snapshot = await fetchMistakes();
      set({
        mistakes: snapshot.mistakes,
        mistakesSummary: snapshot.summary,
        mistakesState: "ready",
      });
    } catch (error) {
      set({ mistakesState: "error", mistakesError: errorText(error, "错题本加载失败") });
    }
  },

  openMistakes: async () => {
    set({ view: "mistakes" });
    await get().loadMistakes();
  },

  closeMistakes: () => set({ view: "list" }),

  setMistakeMastered: async (id, mastered) => {
    // 单条更新失败只记录错误，不清空列表（保留用户已看到的内容）
    set({ mistakesError: null });
    try {
      const { mistake, summary } = await markMistakeApi(id, mastered);
      set((state) => ({
        mistakes: state.mistakes.map((entry) => (entry.id === mistake.id ? mistake : entry)),
        mistakesSummary: summary,
      }));
    } catch (error) {
      set({ mistakesError: errorText(error, "更新错题状态失败") });
    }
  },

  openCourse: (courseId) => set({ view: "detail", activeCourseId: courseId }),

  backToList: () =>
    set({
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
      done: false,
    }),

  openLesson: async (lessonId, lessonName) => {
    set({
      view: "lesson",
      activeLessonId: lessonId,
      activeLessonName: lessonName ?? null,
      lessonState: "loading",
      lessonError: null,
      payload: {},
      stage: null,
      progress: null,
      submitting: false,
      done: false,
    });
    try {
      const snapshot = await startLesson(lessonId);
      // 快照里的 stage 即续学落点（后端 route_from_load 已跳过已完成环节）
      set({
        sessionId: snapshot.session_id,
        stage: snapshot.stage,
        payload: snapshot.payload,
        progress: snapshot.progress as LessonProgress,
        lessonState: "ready",
        done: snapshot.done,
      });
    } catch (error) {
      set({ lessonState: "error", lessonError: errorText(error, "课时加载失败") });
    }
  },

  submit: async (input) => {
    const { sessionId, submitting, done } = get();
    if (!sessionId || submitting || done) return;
    set({ submitting: true, lessonError: null });
    try {
      const snapshot = await stepLesson(sessionId, input);
      set({
        stage: snapshot.stage,
        payload: snapshot.payload,
        progress: snapshot.progress as LessonProgress,
        done: snapshot.done,
        submitting: false,
      });
    } catch (error) {
      set({ submitting: false, lessonError: errorText(error, "提交失败，请重试") });
    }
  },

  finishLesson: async () => {
    // 完成回写后刷新目录：completed_count / 课时状态随之更新（FR-017，T026）
    set({
      view: "detail",
      activeLessonId: null,
      activeLessonName: null,
      lessonState: "idle",
      sessionId: null,
      stage: null,
      payload: {},
      done: false,
    });
    await get().loadCatalog();
  },

  backToDetail: () =>
    set({
      view: "detail",
      activeLessonId: null,
      activeLessonName: null,
      sessionId: null,
      stage: null,
      payload: {},
      progress: null,
      lessonState: "idle",
      lessonError: null,
      done: false,
    }),
}));
