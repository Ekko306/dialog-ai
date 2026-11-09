import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CourseApiError,
  fetchCatalog,
  fetchMistakes,
  markMistake,
  startLesson,
  stepLesson,
} from "@/lib/course-api";

/**
 * course-api 单测（T028）：成功解析、非 2xx 转结构化错误、请求体与路径契约。
 * 契约见 specs/005-premium-course/contracts/。
 */

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchCatalog", () => {
  it("200 时返回解析后的目录", async () => {
    const catalog = { categories: [], summary: { total_lessons: 0, completed_lessons: 0 } };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(catalog));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchCatalog()).resolves.toEqual(catalog);
    expect(fetchMock).toHaveBeenCalledWith("/api/course/catalog", undefined);
  });
});

describe("错误分支", () => {
  it("非 2xx 抛出 CourseApiError，带 status 与 detail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ detail: "lesson not found" }, 404)),
    );

    await expect(startLesson("missing")).rejects.toMatchObject({
      name: "CourseApiError",
      message: "lesson not found",
      status: 404,
    });
  });

  it("错误体不是 JSON 时使用默认文案", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("boom", { status: 503 })),
    );

    await expect(fetchCatalog()).rejects.toBeInstanceOf(CourseApiError);
    await fetchCatalog().catch((error: CourseApiError) => {
      expect(error.status).toBe(503);
      expect(error.message).toBe("请求失败（503）");
    });
  });

  it("网络异常时 status 为 0", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    await expect(fetchCatalog()).rejects.toMatchObject({ status: 0 });
  });
});

describe("stepLesson", () => {
  it("按契约提交 session_id 与 input", async () => {
    const snapshot = { session_id: "local:l1:abc", stage: "knowledge", payload: {}, progress: {}, done: false };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(snapshot));
    vi.stubGlobal("fetch", fetchMock);

    await expect(stepLesson("local:l1:abc", "I'm happy")).resolves.toEqual(snapshot);

    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe("/api/course/lesson/step");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual({
      session_id: "local:l1:abc",
      input: "I'm happy",
    });
  });
});

describe("错题本", () => {
  it("fetchMistakes 请求列表接口", async () => {
    const snapshot = { mistakes: [], summary: { total: 0, pending: 0, mastered: 0 } };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(snapshot));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchMistakes()).resolves.toEqual(snapshot);
    expect(fetchMock).toHaveBeenCalledWith("/api/course/mistakes", undefined);
  });

  it("markMistake 提交 id 与 mastered", async () => {
    const body = {
      mistake: { id: "l1::ex1", status: "mastered" },
      summary: { total: 1, pending: 0, mastered: 1 },
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(body));
    vi.stubGlobal("fetch", fetchMock);

    await expect(markMistake("l1::ex1", true)).resolves.toEqual(body);

    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe("/api/course/mistakes/mark");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ id: "l1::ex1", mastered: true });
  });
});
