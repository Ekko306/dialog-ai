"use client";

import { CheckCircle2, ChevronLeft, LoaderCircle, TriangleAlert } from "lucide-react";

import { useCourseStore } from "@/lib/course-store";
import type {
  ExercisePayload,
  IntroPayload,
  KnowledgePayload,
  LessonStage,
  RoleplayPayload,
  SummaryPayload,
} from "@/lib/course-types";

import { StageExercise } from "./stage-exercise";
import { StageIntro } from "./stage-intro";
import { StageKnowledge } from "./stage-knowledge";
import { StageRoleplay } from "./stage-roleplay";
import { StageSummary } from "./stage-summary";

const STAGE_ORDER: LessonStage[] = ["intro", "knowledge", "exercise", "roleplay", "summary"];

const STAGE_LABEL: Record<string, string> = {
  intro: "场景跟读",
  knowledge: "知识点",
  exercise: "小练习",
  roleplay: "对话练习",
  summary: "课时总结",
};

/** 全屏学习页（US2/T019）：按 stage 渲染五环节，底部由各环节自带操作按钮 */
export function LessonPlayer() {
  const {
    stage,
    payload,
    progress,
    submitting,
    done,
    lessonState,
    lessonError,
    activeLessonName,
    activeLessonId,
    submit,
    backToDetail,
    finishLesson,
    openLesson,
  } = useCourseStore();

  const stageIndex = stage ? STAGE_ORDER.indexOf(stage) : -1;
  const degraded = payload.degraded === true;

  const leave = () => {
    if (done) {
      void finishLesson();
      return;
    }
    const confirmed = window.confirm("退出学习？当前进度已保存，下次可以继续。");
    if (confirmed) backToDetail();
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-2 px-3 pt-4 pb-2">
        <button
          type="button"
          onClick={leave}
          aria-label="退出学习"
          className="text-muted-foreground hover:text-foreground -ml-1 rounded-full p-2 transition"
        >
          <ChevronLeft className="size-5" />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold">{activeLessonName ?? "精品课"}</h1>
          <p className="text-muted-foreground text-[11px]">
            {stage && stage !== "completed" ? STAGE_LABEL[stage] ?? "" : "已完成"}
          </p>
        </div>
        <div className="flex items-center gap-1.5" aria-label="环节进度">
          {STAGE_ORDER.map((item, index) => (
            <span
              key={item}
              className={`h-1.5 w-5 rounded-full transition ${
                index <= stageIndex ? "bg-primary" : "bg-muted"
              }`}
            />
          ))}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-2 pb-8">
        {lessonState === "loading" && (
          <div className="flex flex-col items-center gap-3 py-16" aria-busy="true">
            <LoaderCircle className="text-primary size-6 animate-spin" />
            <p className="text-muted-foreground text-xs">正在准备本课内容…</p>
          </div>
        )}

        {lessonState === "error" && (
          <div className="bg-background mt-8 rounded-3xl p-6 text-center shadow-sm">
            <p className="text-sm text-red-500">{lessonError ?? "课时加载失败"}</p>
            <button
              type="button"
              onClick={() => activeLessonId && void openLesson(activeLessonId)}
              className="bg-primary text-primary-foreground mt-4 rounded-xl px-5 py-2 text-sm"
            >
              重试
            </button>
          </div>
        )}

        {lessonState === "ready" && stage === "intro" && (
          <StageIntro
            payload={payload as unknown as IntroPayload}
            onSubmit={submit}
            submitting={submitting}
          />
        )}
        {lessonState === "ready" && stage === "knowledge" && (
          <StageKnowledge
            payload={payload as unknown as KnowledgePayload}
            onSubmit={submit}
            submitting={submitting}
          />
        )}
        {lessonState === "ready" && stage === "exercise" && (
          <StageExercise
            payload={payload as unknown as ExercisePayload}
            onSubmit={submit}
            submitting={submitting}
          />
        )}
        {lessonState === "ready" && stage === "roleplay" && (
          <StageRoleplay
            payload={payload as unknown as RoleplayPayload}
            transcript={progress?.roleplay_transcript ?? []}
            onSubmit={submit}
            submitting={submitting}
          />
        )}
        {lessonState === "ready" && stage === "summary" && (
          <StageSummary
            payload={payload as unknown as SummaryPayload}
            onSubmit={submit}
            submitting={submitting}
          />
        )}

        {done && (
          <div className="bg-background mt-6 rounded-3xl p-8 text-center shadow-sm ring-1 ring-black/5">
            <CheckCircle2 className="mx-auto size-10 text-(--icon-brand-green)" />
            <h2 className="mt-3 text-lg font-bold">课时完成！</h2>
            <p className="text-muted-foreground mt-1 text-xs">本课已计入学习进度</p>
            <button
              type="button"
              onClick={() => void finishLesson()}
              className="bg-primary text-primary-foreground mt-5 rounded-xl px-6 py-2.5 text-sm font-medium"
            >
              返回课程
            </button>
          </div>
        )}

        {degraded && (
          <p className="mt-4 flex items-center justify-center gap-1 text-center text-[11px] text-amber-700">
            <TriangleAlert className="size-3.5" />
            本次评价服务暂不可用，已使用默认反馈，不影响继续学习
          </p>
        )}

        {lessonError && lessonState === "ready" && (
          <p className="mt-4 text-center text-xs text-red-500">{lessonError}</p>
        )}
      </div>
    </div>
  );
}
