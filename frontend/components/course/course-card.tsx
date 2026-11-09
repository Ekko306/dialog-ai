"use client";

import { BookOpen, ChevronRight } from "lucide-react";

import type { Course } from "@/lib/course-types";

/** 封面色板（数据侧 cover_color → 渐变；未知值回落到主题绿） */
const COVER_GRADIENTS: Record<string, string> = {
  green: "from-[oklch(0.95_0.12_128)] to-[oklch(0.86_0.16_140)]",
  blue: "from-[oklch(0.94_0.06_250)] to-[oklch(0.85_0.12_250)]",
  orange: "from-[oklch(0.96_0.07_75)] to-[oklch(0.87_0.14_70)]",
  purple: "from-[oklch(0.94_0.08_300)] to-[oklch(0.84_0.13_300)]",
  pink: "from-[oklch(0.95_0.08_350)] to-[oklch(0.86_0.12_350)]",
  teal: "from-[oklch(0.93_0.08_180)] to-[oklch(0.83_0.12_180)]",
  red: "from-[oklch(0.95_0.10_25)] to-[oklch(0.85_0.16_25)]",
  indigo: "from-[oklch(0.94_0.07_270)] to-[oklch(0.84_0.11_270)]",
};

interface CourseCardProps {
  course: Course;
  onOpen: (courseId: string) => void;
}

/** 课程卡片（US1）：封面 + 名称 + 简介 + 完成进度，点击进入章节明细 */
export function CourseCard({ course, onOpen }: CourseCardProps) {
  const completed = course.completed_count;
  const total = Math.max(course.lesson_count, 1);
  const percent = Math.round((completed / total) * 100);
  const finished = completed >= course.lesson_count;
  const gradient = COVER_GRADIENTS[course.cover_color] ?? COVER_GRADIENTS.green;

  return (
    <button
      type="button"
      onClick={() => onOpen(course.id)}
      className="group bg-background flex w-full items-start gap-3 rounded-3xl p-4 text-left shadow-sm ring-1 ring-black/5 transition hover:shadow-md active:scale-[0.99]"
    >
      <div
        className={`flex size-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br ${gradient}`}
      >
        <BookOpen className="text-foreground/70 size-6" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="truncate text-base font-semibold">{course.name}</h3>
          {finished && (
            <span className="shrink-0 rounded-full bg-(--bubble-ai) px-2 py-0.5 text-[10px] font-medium">
              已完成
            </span>
          )}
        </div>
        <p className="text-muted-foreground mt-1 line-clamp-2 text-xs leading-relaxed">
          {course.description}
        </p>

        <div className="mt-3 flex items-center gap-2">
          <div className="bg-muted h-1.5 flex-1 overflow-hidden rounded-full">
            <div className="bg-primary h-full rounded-full" style={{ width: `${percent}%` }} />
          </div>
          <span className="text-muted-foreground shrink-0 text-[11px] tabular-nums">
            {completed}/{course.lesson_count} 课时
          </span>
          <ChevronRight className="text-muted-foreground size-4 transition group-hover:translate-x-0.5" />
        </div>
      </div>
    </button>
  );
}
