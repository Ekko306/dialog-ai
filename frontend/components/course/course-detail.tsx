"use client";

import { CheckCircle2, ChevronLeft, Circle, PlayCircle } from "lucide-react";

import type { Course, LessonBrief, LessonStatus } from "@/lib/course-types";

const STATUS_TEXT: Record<LessonStatus, string> = {
  not_started: "未开始",
  in_progress: "学习中",
  completed: "已完成",
};

const ACTION_TEXT: Record<LessonStatus, string> = {
  not_started: "开始学习",
  in_progress: "继续学习",
  completed: "复习",
};

interface CourseDetailProps {
  course: Course;
  onBack: () => void;
  onOpenLesson: (lessonId: string) => void;
}

/** 课程明细（US1/T017）：章节 → 课时清单，按进度展示状态与「开始/继续/复习」入口 */
export function CourseDetail({ course, onBack, onOpenLesson }: CourseDetailProps) {
  const total = Math.max(course.lesson_count, 1);
  const percent = Math.round((course.completed_count / total) * 100);

  return (
    <div className="mx-auto w-full max-w-2xl px-5 pt-4 pb-6">
      <header className="flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          aria-label="返回课程列表"
          className="text-muted-foreground hover:text-foreground -ml-2 rounded-full p-2 transition"
        >
          <ChevronLeft className="size-5" />
        </button>
        <h1 className="text-lg font-bold">课程详情</h1>
      </header>

      <section className="mt-4 rounded-3xl bg-background p-5 shadow-sm ring-1 ring-black/5">
        <h2 className="text-xl font-bold">{course.name}</h2>
        <p className="text-muted-foreground mt-2 text-xs leading-relaxed">{course.description}</p>
        <div className="mt-4 flex items-center gap-3">
          <div className="bg-muted h-2 flex-1 overflow-hidden rounded-full">
            <div className="bg-primary h-full rounded-full" style={{ width: `${percent}%` }} />
          </div>
          <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
            已完成 {course.completed_count}/{course.lesson_count} 课时
          </span>
        </div>
      </section>

      <div className="mt-5 space-y-4">
        {course.chapters.map((chapter) => (
          <section key={chapter.id} className="rounded-3xl bg-background p-4 shadow-sm ring-1 ring-black/5">
            <h3 className="px-1 text-sm font-semibold">{chapter.name}</h3>
            <ul className="mt-3 space-y-2">
              {chapter.lessons.map((lesson) => (
                <LessonRow key={lesson.id} lesson={lesson} onOpen={onOpenLesson} />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

interface LessonRowProps {
  lesson: LessonBrief;
  onOpen: (lessonId: string) => void;
}

function LessonRow({ lesson, onOpen }: LessonRowProps) {
  const done = lesson.status === "completed";

  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(lesson.id)}
        className="hover:bg-muted/60 flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition"
      >
        {done ? (
          <CheckCircle2 className="size-5 shrink-0 text-(--icon-brand-green)" />
        ) : (
          <Circle className="text-muted-foreground/50 size-5 shrink-0" />
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{lesson.name}</span>
          <span className="text-muted-foreground mt-0.5 block text-[11px]">
            {STATUS_TEXT[lesson.status]}
          </span>
        </span>
        <span
          className={`flex shrink-0 items-center gap-1 rounded-full px-3 py-1 text-[11px] font-medium ${
            done
              ? "bg-muted text-muted-foreground"
              : "bg-primary text-primary-foreground"
          }`}
        >
          <PlayCircle className="size-3.5" />
          {ACTION_TEXT[lesson.status]}
        </span>
      </button>
    </li>
  );
}
