"use client";

import { useEffect, useRef } from "react";
import { useLangChainInterruptState, useLangChainRespond } from "@assistant-ui/react-langchain";

import { useSceneStore } from "@/lib/scene-store";

/**
 * 润色语音询问自动应答（2026-10-28 产品决策，纯前端零后端改动）：
 * 后端 talk_graph.audio_choice_node 在语法正确（has_no_issue）分支 interrupt 询问
 * 「是否将润色结果合成为语音？(yes/no)」（该 prompt 全图唯一，含"合成为语音"，
 * 与 HITL_node 的"请输入指令"天然区分）。用户要求不出现该询问：
 * 检测到特征 prompt 即自动 respond("yes")——图自动恢复（enable_tts=True →
 * tts_node 合成语音 → 润色气泡渲染），全程用户无感知。
 * 兜底：respond 失败仅 console.error，interrupt 保持原样，输入框仍可手动输入；
 * pendingScene 存在时让位 SceneApplier（同一 interrupt 只能被 respond 一次，
 * 避免两个自动应答争抢）。
 */
export function PolisherTtsAutoResponder() {
  const interrupt = useLangChainInterruptState();
  const respond = useLangChainRespond();
  const pendingScene = useSceneStore((s) => s.pendingScene);

  // 同一 interrupt 只应答一次：按对象引用去重（新 interrupt 是新对象，
  // StrictMode effect 双跑被同引用拦截，不会双发 resume）
  const handledRef = useRef<unknown>(null);

  useEffect(() => {
    if (!interrupt || pendingScene || handledRef.current === interrupt) return;
    const value: unknown = interrupt.value;
    const prompt =
      typeof value === "object" && value !== null
        ? String((value as { prompt?: string }).prompt ?? "")
        : String(value ?? "");
    if (!prompt.includes("合成为语音")) return;
    handledRef.current = interrupt;
    respond("yes").catch((e: unknown) => {
      // 恢复失败（网络异常/已被消费）：询问保持显示，用户可手动输入 yes
      console.error("[PolisherTtsAutoResponder] 自动应答失败", e);
    });
  }, [interrupt, respond, pendingScene]);

  return null;
}
