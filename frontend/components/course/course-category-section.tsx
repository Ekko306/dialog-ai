"use client";

import type { CourseCategory } from "@/lib/course-types";
import { CourseCard } from "./course-card";

interface CourseCategorySectionProps {
  category: CourseCategory;
  onOpenCourse: (courseId: string) => void;
}

/** 分类分组（US1）：分类名 + 该分类下的课程卡片列表 */
export function CourseCategorySection({ category, onOpenCourse }: CourseCategorySectionProps) {
  if (category.courses.length === 0) return null;

  return (
    <section className="space-y-3">
      <h2 className="text-muted-foreground px-1 text-xs font-medium tracking-wide">
        {category.name}
      </h2>
      <div className="space-y-3">
        {category.courses.map((course) => (
          <CourseCard key={course.id} course={course} onOpen={onOpenCourse} />
        ))}
      </div>
    </section>
  );
}
