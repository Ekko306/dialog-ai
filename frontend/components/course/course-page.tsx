"use client";

import { BookOpen, BookX, ChevronRight, LoaderCircle } from "lucide-react";
import { useEffect } from "react";

import { useCourseStore } from "@/lib/course-store";
import type { CourseCatalog } from "@/lib/course-types";

import { CourseCategorySection } from "./course-category-section";
import { CourseDetail } from "./course-detail";
import { LessonPlayer } from "./lesson-player";
import { MistakeBook } from "./mistake-book";

/**
 * 精讲课 Tab 入口（US1/T016）：
 * 列表（分类分组 + 课程卡片）→ 详情（章节/课时）→ 学习页（全屏五环节），
 * 视图切换全部由 course-store 驱动；挂载时拉取目录，失败可重试（FR-014）。
 */
export function CoursePage() {
  const {
    view,
    catalog,
    catalogState,
    catalogError,
    activeCourseId,
    mistakesSummary,
    loadCatalog,
    loadMistakes,
    openMistakes,
    openCourse,
    backToList,
    openLesson,
  } = useCourseStore();

  useEffect(() => {
    if (useCourseStore.getState().catalogState === "idle") void loadCatalog();
    if (useCourseStore.getState().mistakesState === "idle") void loadMistakes();
  }, [loadCatalog, loadMistakes]);

  if (view === "lesson") return <LessonPlayer />;
  if (view === "mistakes") return <MistakeBook />;

  const course = catalog?.categories
    .flatMap((category) => category.courses)
    .find((item) => item.id === activeCourseId);

  if (view === "detail" && course) {
    return (
      <div className="h-full overflow-y-auto">
        <CourseDetail
          course={course}
          onBack={backToList}
          onOpenLesson={(lessonId) => void openLesson(lessonId, lessonNameOf(course, lessonId))}
        />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl px-5 pt-6 pb-6">
        <header className="flex items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">精讲课</h1>
            <p className="text-muted-foreground mt-1 text-xs">
              跟着教练练一句，场景里马上能用
            </p>
          </div>
          {catalogState === "ready" && catalog && (
            <span className="bg-background shrink-0 rounded-full px-3 py-1 text-[11px] shadow-sm ring-1 ring-black/5">
              已完成 {catalog.summary.completed_lessons}/{catalog.summary.total_lessons}
            </span>
          )}
        </header>

        {catalogState === "ready" && catalog && (
          <ProgressOverview catalog={catalog} pendingMistakes={mistakesSummary?.pending ?? 0} onOpenMistakes={openMistakes} />
        )}

        {catalogState === "loading" && <ListSkeleton />}

        {catalogState === "error" && (
          <section className="bg-background mt-5 rounded-3xl p-8 text-center shadow-sm">
            <p className="text-sm text-red-500">课程加载失败：{catalogError ?? "未知错误"}</p>
            <button
              type="button"
              onClick={() => void loadCatalog()}
              className="bg-primary text-primary-foreground mt-4 rounded-xl px-5 py-2 text-sm"
            >
              重试
            </button>
          </section>
        )}

        {catalogState === "ready" && catalog && catalog.categories.length === 0 && (
          <section className="bg-background mt-5 flex flex-col items-center gap-2 rounded-3xl p-10 text-center shadow-sm">
            <BookOpen className="text-muted-foreground size-8" />
            <p className="text-sm font-medium">暂无课程</p>
            <p className="text-muted-foreground text-xs">课程内容正在准备中，稍后再来看看</p>
          </section>
        )}

        {catalogState === "ready" && catalog && catalog.categories.length > 0 && (
          <div className="mt-5 space-y-6">
            {catalog.categories.map((category) => (
              <CourseCategorySection
                key={category.id}
                category={category}
                onOpenCourse={openCourse}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** 从课程数据里取课时名称（学习页标题用；缺失时回落为 undefined） */
function lessonNameOf(course: { chapters: { lessons: { id: string; name: string }[] }[] }, lessonId: string) {
  for (const chapter of course.chapters) {
    const lesson = chapter.lessons.find((item) => item.id === lessonId);
    if (lesson) return lesson.name;
  }
  return undefined;
}

/** 学习进度概览 + 错题本入口（进度来自目录里的课时状态，错题数来自错题本接口） */
function ProgressOverview({
  catalog,
  pendingMistakes,
  onOpenMistakes,
}: {
  catalog: CourseCatalog;
  pendingMistakes: number;
  onOpenMistakes: () => Promise<void>;
}) {
  const lessons = catalog.categories.flatMap((category) =>
    category.courses.flatMap((course) =>
      course.chapters.flatMap((chapter) => chapter.lessons),
    ),
  );
  const total = catalog.summary.total_lessons;
  const completed = catalog.summary.completed_lessons;
  const inProgress = lessons.filter((lesson) => lesson.status === "in_progress").length;
  const notStarted = Math.max(total - completed - inProgress, 0);
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <section className="bg-background mt-4 rounded-3xl p-5 shadow-sm ring-1 ring-black/5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">学习进度</h2>
        <button
          type="button"
          onClick={() => void onOpenMistakes()}
          className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs transition"
        >
          <BookX className="size-3.5" />
          错题本
          {pendingMistakes > 0 && (
            <span className="rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] tabular-nums text-white">
              {pendingMistakes}
            </span>
          )}
          <ChevronRight className="size-3.5" />
        </button>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <div className="bg-muted h-2 flex-1 overflow-hidden rounded-full">
          <div
            className="bg-primary h-full rounded-full transition-all"
            style={{ width: `${percent}%` }}
          />
        </div>
        <span className="text-muted-foreground shrink-0 text-xs tabular-nums">{percent}%</span>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <ProgressStat label="已完成" value={completed} accent />
        <ProgressStat label="学习中" value={inProgress} />
        <ProgressStat label="未开始" value={notStarted} />
      </div>
    </section>
  );
}

function ProgressStat({ label, value, accent = false }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="bg-muted/50 rounded-2xl py-2">
      <p className={`text-base font-semibold tabular-nums ${accent ? "text-primary" : ""}`}>{value}</p>
      <p className="text-muted-foreground mt-0.5 text-[10px]">{label}</p>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="mt-5 space-y-3" aria-busy="true" aria-label="课程加载中">
      {[0, 1, 2].map((index) => (
        <div key={index} className="bg-background flex gap-3 rounded-3xl p-4 shadow-sm">
          <div className="bg-muted size-14 shrink-0 animate-pulse rounded-2xl" />
          <div className="flex-1 space-y-2">
            <div className="bg-muted h-4 w-1/2 animate-pulse rounded" />
            <div className="bg-muted h-3 w-3/4 animate-pulse rounded" />
            <div className="bg-muted h-1.5 w-full animate-pulse rounded-full" />
          </div>
        </div>
      ))}
      <div className="flex items-center justify-center gap-2 pt-2">
        <LoaderCircle className="text-primary size-4 animate-spin" />
        <span className="text-muted-foreground text-[11px]">加载中…</span>
      </div>
    </div>
  );
}
