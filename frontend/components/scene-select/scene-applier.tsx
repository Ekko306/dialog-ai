"use client";

import { useEffect, useRef, useState } from "react";
import { useLangChainInterruptState, useLangChainRespond } from "@assistant-ui/react-langchain";

import { useSceneStore } from "@/lib/scene-store";

/**
 * 场景应用发送器（FR-006/FR-013，契约：specs/002-scene-select-popup/contracts/scene-apply-command.md §2）：
 * - 弹窗选卡片后 pendingScene 就绪；图停在任意 HITL interrupt 时自动 respond 指令
 *   `_set_context_::<role>::<scenario>`（与既有 _new_context_ 同一协议，指令不进 messages）
 * - 成功：清除 pendingScene（后端 save_context 已落 Store，下一条教练回复即新场景）
 * - 失败（respond reject，如网络/服务异常）：清除 pendingScene（保留当前生效场景，不中断对话）
 *   + setApplyError 触发 scene-apply-toast（FR-013）
 * - 图运行中/冷启动（无 interrupt）时指令暂存，待下一个 interrupt 出现由本 effect 自动补发
 * - 禁令：绝不把指令作为普通用户消息发送（会污染 messages）
 */
export function SceneApplier() {
  const interrupt = useLangChainInterruptState();
  const respond = useLangChainRespond();
  const pendingScene = useSceneStore((s) => s.pendingScene);
  const clearPending = useSceneStore((s) => s.clearPending);
  const setApplyError = useSceneStore((s) => s.setApplyError);
  const setApplyNotice = useSceneStore((s) => s.setApplyNotice);

  // 同一 pendingScene 只尝试一次：respond 成功后 interrupt 变化会再次触发 effect，
  // 用 ref 防止对同一指令重复发送
  const attemptedRef = useRef<string | null>(null);
  // "暂存待生效"中性提示只提示一次（同一次选择），避免 effect 反复触发 toast
  const noticedRef = useRef<string | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!pendingScene || !interrupt || sending) return;
    const command = `_set_context_::${pendingScene.role}::${pendingScene.scenario}`;
    if (attemptedRef.current === command) return;

    attemptedRef.current = command;
    setSending(true);
    respond(command)
      .then(() => {
        clearPending();
      })
      .catch(() => {
        // 保留当前生效场景（清 pending），可感知失败提示（FR-013）
        clearPending();
        setApplyError("场景应用失败，请检查服务连接后重试");
      })
      .finally(() => {
        setSending(false);
      });
  }, [pendingScene, interrupt, sending, respond, clearPending, setApplyError]);

  // 无 interrupt（冷启动/服务不可达/图运行中）：指令暂存待补发（plan R3），
  // 不是失败而是延迟生效——给中性可感知提示（FR-013 精神），同一次选择只提示一次
  useEffect(() => {
    if (!pendingScene || interrupt) return;
    const command = `_set_context_::${pendingScene.role}::${pendingScene.scenario}`;
    if (noticedRef.current === command) return;
    noticedRef.current = command;
    setApplyNotice("场景已暂存，将在对话恢复后生效");
  }, [pendingScene, interrupt, setApplyNotice]);

  // pendingScene 变更（新的一次选择）后允许再次尝试
  useEffect(() => {
    if (!pendingScene) {
      attemptedRef.current = null;
      noticedRef.current = null;
    }
  }, [pendingScene]);

  return null;
}
