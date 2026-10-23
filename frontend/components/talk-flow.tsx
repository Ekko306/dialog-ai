"use client";

import {
  useLangChainInterruptState,
  useLangChainRespond,
  useLangChainStream,
  useLangChainSubmit,
} from "@assistant-ui/react-langchain";
import { MessageCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/**
 * 单输入框循环对话流（与后端 talk_agent 图约定）：
 * 1. 「新会话」常显入口：无对话（首次）时点击 → 发起首轮空输入 run（new_dialog_node
 *    让 coach 出话题 → 停在 HITL）；有历史对话且停在 HITL 时点击 → respond 提交内部
 *    指令 _new_context_（new_context_node 切场景 → END → AutoContinue 续跑出新话题）
 * 2. InterruptPrompt（唯一输入框）resume：用户提交语音转写文本或音频文件路径 →
 *    语法检查/纠错 → END
 * 3. AutoContinue 检测到 run 结束且未停在 interrupt（即跑到 END）时，
 *    自动发起下一轮 run：continue_dialog_node 读上轮 raw_text 给 coach 提示
 *    → 再次停在 HITL → 回到第 2 步循环
 *
 * 注意：发起新 run 用 submit（REST 路径）；恢复 interrupt 必须用 respond
 * （input.respond 协议）。submit(null, {command:{resume}}) 在当前 SDK/服务端
 * 组合下不会真正恢复图，不要使用。
 */

/**
 * 常显「新会话」气泡：任何状态下都渲染（busy 时仅置灰），点击后不消失。
 * 双路径：首次无对话 → submit({}) 发起首轮 run；有历史且图停在 HITL →
 * respond("_new_context_") 恢复 interrupt 走 new_context_node 切换新场景
 * （HITL_node 对内部指令不写 messages，对话流不会出现 _new_context_ 字样）。
 */
export function NewDialogButton() {
  const stream = useLangChainStream();
  const submit = useLangChainSubmit();
  const respond = useLangChainRespond();
  const interrupt = useLangChainInterruptState();
  const [starting, setStarting] = useState(false);

  const hasMessages = (stream?.messages?.length ?? 0) > 0;
  // 启动中 / 运行时未就绪 / run 进行中：按钮置禁用但不消失
  const busy = starting || !stream || stream.isLoading;
  // 有历史对话且图停在 HITL：点击走 _new_context_ 切场景，其余情况一律发起新 run
  const switchContext = Boolean(interrupt) && hasMessages;

  const handleClick = async () => {
    setStarting(true);
    try {
      if (switchContext) {
        await respond("_new_context_");
      } else {
        // 首轮空输入：后端 new_dialog_node 忽略入参，直接让 coach 出话题
        await submit({});
      }
    } finally {
      setStarting(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void handleClick()}
      disabled={busy}
      className="bg-background text-foreground flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium shadow-sm transition-shadow hover:shadow-md disabled:opacity-50"
    >
      <MessageCircle className="size-4" aria-hidden />
      {starting ? "启动中…" : "新会话"}
    </button>
  );
}

/** run 结束且未停在 interrupt（跑到 END）时，自动发起下一轮 run */
export function AutoContinue() {
  const stream = useLangChainStream();
  const submit = useLangChainSubmit();
  const firingRef = useRef(false);
  const lastFireAtRef = useRef(0);
  const settleTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const streamRef = useRef(stream);

  // 两段 settle：SDK 流重订阅（ERR_ABORTED 重连）或「messages 先于 interrupt 到达」的
  // 窗口期内，isLoading/interrupt 会短暂呈现「run 已结束且无挂起」的假象，立即 submit
  // 会重复发起 run（下一轮出现两条话题）或抢在 interrupt 事件前占用线程（后续 resume
  // 报 already-consumed interrupt）。因此每段 settle 后都用最新 stream 状态复查全部条件
  const SETTLE_MS = 500;
  const MIN_FIRE_GAP_MS = 2000;

  useEffect(() => {
    if (!stream) return;
    streamRef.current = stream;
    if (stream.isLoading) return; // run 进行中
    if (firingRef.current) return; // 防重入
    if ((stream.messages?.length ?? 0) === 0) return; // 线程未启动，等「新对话」
    if (stream.interrupt != null) return; // 停在 HITL，等用户输入
    if (stream.error) return; // 出错时不自动续跑
    if (Date.now() - lastFireAtRef.current < MIN_FIRE_GAP_MS) return;
    if (settleTimersRef.current.length > 0) return; // 已有 settle 判定在等待

    const settleAndCheck = (stage: 1 | 2) => {
      const timer = setTimeout(() => {
        settleTimersRef.current = settleTimersRef.current.filter((t) => t !== timer);
        const s = streamRef.current;
        const settled =
          !!s &&
          !s.isLoading &&
          s.interrupt == null &&
          !s.error &&
          (s.messages?.length ?? 0) > 0 &&
          Date.now() - lastFireAtRef.current >= MIN_FIRE_GAP_MS;
        if (!settled) return; // 条件失效（如 interrupt 事件晚到）→ 放弃，等 effect 下次触发
        if (stage === 1) {
          settleAndCheck(2); // 第一段通过 → 第二段确认状态持续稳定
          return;
        }
        firingRef.current = true;
        lastFireAtRef.current = Date.now();
        submit({})
          .catch(() => {})
          .finally(() => {
            firingRef.current = false;
          });
      }, SETTLE_MS);
      settleTimersRef.current.push(timer);
    };
    settleAndCheck(1);
  }, [stream, submit, stream?.isLoading, stream?.interrupt, stream?.error, stream?.messages]);

  // 卸载时清理未触发的 settle 定时器
  useEffect(
    () => () => {
      settleTimersRef.current.forEach(clearTimeout);
      settleTimersRef.current = [];
    },
    [],
  );

  return null;
}
