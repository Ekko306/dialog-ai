"use client";

import {
  useLangChainInterruptState,
  useLangChainStream,
  useLangChainSubmit,
} from "@assistant-ui/react-langchain";
import { useEffect, useRef, useState } from "react";

/**
 * 单输入框循环对话流（与后端 talk_agent 图约定）：
 * 1. 首页「新对话」→ 发起首轮空输入 run：new_dialog_node 让 coach 出话题 → 停在 HITL
 * 2. InterruptPrompt（唯一输入框）resume：用户提交音频文件路径 → 语法检查/纠错 → END
 * 3. AutoContinue 检测到 run 结束且未停在 interrupt（即跑到 END）时，
 *    自动发起下一轮 run：continue_dialog_node 读上轮 raw_text 给 coach 提示
 *    → 再次停在 HITL → 回到第 2 步循环
 *
 * 注意：发起新 run 用 submit（REST 路径）；恢复 interrupt 必须用 respond
 * （input.respond 协议）。submit(null, {command:{resume}}) 在当前 SDK/服务端
 * 组合下不会真正恢复图，不要使用。
 */

/** 首屏入口：线程未启动（无消息且无暂停中的 interrupt）时显示「新对话」按钮 */
export function NewDialogButton() {
  const stream = useLangChainStream();
  const submit = useLangChainSubmit();
  const interrupt = useLangChainInterruptState();
  const [starting, setStarting] = useState(false);

  // 线程已启动 / 图在运行 / 停在 HITL / 正在启动：都不显示入口
  if (!stream || starting || stream.isLoading || interrupt) return null;
  if ((stream.messages?.length ?? 0) > 0) return null;

  const start = async () => {
    setStarting(true);
    try {
      // 首轮空输入：后端 new_dialog_node 忽略入参，直接让 coach 出话题
      await submit({});
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-(--thread-max-width) justify-center pb-2">
      <button
        type="button"
        onClick={() => void start()}
        disabled={starting}
        className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-full px-5 py-2 text-sm font-medium transition-colors disabled:opacity-50"
      >
        {starting ? "启动中…" : "新对话"}
      </button>
    </div>
  );
}

/** run 结束且未停在 interrupt（跑到 END）时，自动发起下一轮 run */
export function AutoContinue() {
  const stream = useLangChainStream();
  const submit = useLangChainSubmit();
  const firingRef = useRef(false);

  useEffect(() => {
    if (!stream) return;
    if (stream.isLoading) return; // run 进行中
    if (firingRef.current) return; // 防重入
    if ((stream.messages?.length ?? 0) === 0) return; // 线程未启动，等「新对话」
    if (stream.interrupt != null) return; // 停在 HITL，等用户输入
    if (stream.error) return; // 出错时不自动续跑

    firingRef.current = true;
    submit({})
      .catch(() => {})
      .finally(() => {
        firingRef.current = false;
      });
  }, [stream, submit, stream?.isLoading, stream?.interrupt, stream?.error, stream?.messages]);

  return null;
}
