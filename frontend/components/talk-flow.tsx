"use client";

import {
  useLangChainInterruptState,
  useLangChainRespond,
  useLangChainStream,
  useLangChainSubmit,
} from "@assistant-ui/react-langchain";
import { useAui } from "@assistant-ui/react";
import { MessageCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ensureBackendPersona, type BackendPersona } from "@/lib/backend-persona";

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
 * respond(contextCommand ?? "_new_context_") 恢复 interrupt（HITL_node 对内部
 * 指令不写 messages，对话流不会出现指令字样）。
 *
 * 人设防串台（2026-10-27，backend-persona.ts）：后端教练人设是全局单例 Store，
 * 发起任何新 run 前必须确保本页人设已写入——点击时 await ensureBackendPersona
 * （页面挂载时已写一次，这里兜底快速点击早于挂载写入完成的窗口）。
 * contextCommand：角色页传 `_set_context_::<role>::<scenario>`（保持本角色人设
 * 出新话题）；主对话不传 → _new_context_ 场景轮换（002 语义）。
 */
export function NewDialogButton({
  persona,
  contextCommand,
  viaNewThread,
}: {
  persona?: BackendPersona;
  contextCommand?: string;
  /**
   * 角色页=true：无活 interrupt 的有消息线程（END/死 interrupt 锁死）上，同线程
   * respond(_set_context_) 或 submit({}) 都会触发后端 continue_dialog_node 的
   * raw_text=None 崩溃（checkpoint 持久 new_dialog=False，2026-10-28 实测复现；
   * 后端修复不在前端项目范围内）→ 改为切换全新线程重启：新线程 new_dialog 默认
   * true → new_dialog_node 固定开场，人设由 ensureBackendPersona 的 Store 直写
   * 保证；空线程确认后自动补发首轮 run。主对话不传此 prop，001 行为零变化。
   */
  viaNewThread?: boolean;
}) {
  const stream = useLangChainStream();
  const submit = useLangChainSubmit();
  const respond = useLangChainRespond();
  const interrupt = useLangChainInterruptState();
  const [starting, setStarting] = useState(false);
  // 人设写入失败标记：Store 空 + 静默发指令 = run 读缺省人设"英语口语教练"
  //（角色页串台，2026-10-27 实测复现）——失败时中止并引导重试
  const [syncFailed, setSyncFailed] = useState(false);
  // viaNewThread：已切到新线程、待空态确认后自动补发首轮 run
  const [pendingAutoStart, setPendingAutoStart] = useState(false);
  const aui = useAui();

  const hasMessages = (stream?.messages?.length ?? 0) > 0;
  // 启动中 / 运行时未就绪 / run 进行中：按钮置禁用但不消失
  const busy = starting || pendingAutoStart || !stream || stream.isLoading;
  // 有历史对话且图停在 HITL：点击走 contextCommand 切场景/人设，其余情况发起新 run
  const switchContext = Boolean(interrupt) && hasMessages;

  const handleClick = async () => {
    setStarting(true);
    setSyncFailed(false);
    try {
      // 后端人设写入完成后再发起 run（首轮新话题即读本页人设）
      const apiUrl =
        process.env.NEXT_PUBLIC_LANGGRAPH_API_URL ||
        (typeof window !== "undefined" ? new URL("/api", window.location.href).href : undefined);
      if (persona && apiUrl) {
        const ok = await ensureBackendPersona(apiUrl, persona);
        if (!ok) {
          // langgraph dev 的 Store 是内存态（后端重启即清空）：此时发指令
          // 会产出缺省人设的错误话题——中止发指令，文案引导点按重试
          setSyncFailed(true);
          return;
        }
      }
      if (switchContext) {
        await respond(contextCommand ?? "_new_context_");
      } else if (viaNewThread && hasMessages) {
        // END/死锁线程：同线程 submit({}) 会进后端 continue_dialog_node 且
        // raw_text=None（checkpoint 持久 new_dialog=False）→ run 必炸——
        // 切全新线程重启（onThreadIdChange 落库新绑定），空线程确认后由下方
        // effect 自动补发首轮 run
        setPendingAutoStart(true);
        aui.threads.switchToNewThread();
        return;
      } else {
        // 首轮空输入：后端 new_dialog_node 忽略入参，直接让 coach 出话题
        await submit({});
      }
    } finally {
      setStarting(false);
    }
  };

  // switchToNewThread 就绪（stream 已切到空线程）后自动补发首轮 run——
  // 不在点击时直接 submit：新线程切换经 store 传播，立即 submit 可能打到旧线程。
  // 守卫条件保证只在 pending 且确认空态时触发一次。
  useEffect(() => {
    if (pendingAutoStart && (stream?.messages?.length ?? 0) === 0) {
      setPendingAutoStart(false);
      void submit({});
    }
  }, [pendingAutoStart, stream, submit]);

  return (
    <button
      type="button"
      onClick={() => void handleClick()}
      disabled={busy}
      className="bg-background text-foreground flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium shadow-sm transition-shadow hover:shadow-md disabled:opacity-50"
    >
      <MessageCircle className="size-4" aria-hidden />
      {syncFailed ? "人设同步失败，点按重试" : starting ? "启动中…" : "新会话"}
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
  // error 宽限期结束时没有新事件到达（END 状态不再产生事件），effect 不会重跑——
  // 用 tick 强制重查；tick 计入 deps，保证到点后 effect 必定重跑
  //（不依赖 useLangChainStream 每次渲染返回新引用这一实现细节，2026-10-27 加固）
  const [graceTick, forceTick] = useState(0);
  // 本会话是否观察到过 run 运行：跨会话水合（进入页面读历史）不算。
  // 动机：图停在子图内 HITL 中断时，interrupt 信息不上浮到根 state（tasks[].interrupts=[]），
  // 进入页面后 interrupt 守卫失效；若失败 run 的 join 尚未把 error 送达，守卫全绿 →
  // 会对停在图中的线程发 submit({})，后端 resume 校验崩溃（HumanMessage content=null）。
  const ranInSessionRef = useRef(false);
  // 水合窗口：挂载后 HYDRATION_MS 内禁止自动续跑——join 失败 run 的 error 事件与
  // state 内 interrupt 信息需数百 ms～数 s 才送达，期间守卫呈现假绿（实测 10:20:33 竞态）。
  const mountedAtRef = useRef(Date.now());
  // error 宽限：SDK 的 stream.error 在后续成功 run 后不清除（透传 root.error，滞留），
  // 「error 即挡续跑」会被过期错误永久锁死（2026-10-27 Lisa 实测死锁：stale respond 失败
  // → error 滞留 → 图跑到 END 后 AutoContinue 不接手 → 线程停在 END 无任何入口）。
  // 因此 error 只在出现后 ERROR_GRACE_MS 内挡续跑（留给真实错误的观察期），过期放行；
  // 真实错误放行后 submit({}) 也只是正常发起 new_dialog，不会打崩后端。
  const errorAtRef = useRef<number | null>(null);
  const lastErrorRef = useRef<unknown>(null);
  if (stream?.error !== lastErrorRef.current) {
    lastErrorRef.current = stream?.error;
    errorAtRef.current = stream?.error != null ? Date.now() : null;
  }
  const ERROR_GRACE_MS = 8000;
  const inErrorGrace =
    stream?.error != null &&
    errorAtRef.current != null &&
    Date.now() - errorAtRef.current < ERROR_GRACE_MS;

  // 两段 settle：SDK 流重订阅（ERR_ABORTED 重连）或「messages 先于 interrupt 到达」的
  // 窗口期内，isLoading/interrupt 会短暂呈现「run 已结束且无挂起」的假象，立即 submit
  // 会重复发起 run（下一轮出现两条话题）或抢在 interrupt 事件前占用线程（后续 resume
  // 报 already-consumed interrupt）。因此每段 settle 后都用最新 stream 状态复查全部条件
  const SETTLE_MS = 500;
  const MIN_FIRE_GAP_MS = 2000;
  const HYDRATION_WINDOW_MS = 3000;

  useEffect(() => {
    if (!stream) return;
    streamRef.current = stream;
    if (stream.isLoading) {
      ranInSessionRef.current = true; // 本会话内有 run 运行过，结束后才允许自动续跑
      return;
    }
    if (!ranInSessionRef.current) return; // 进入页面仅水合历史，绝不自动发起 run
    if (Date.now() - mountedAtRef.current < HYDRATION_WINDOW_MS) return;
    if (firingRef.current) return; // 防重入
    if ((stream.messages?.length ?? 0) === 0) return; // 线程未启动，等「新对话」
    if (stream.interrupt != null) return; // 停在 HITL，等用户输入
    if (inErrorGrace) {
      // 宽限期结束后无新事件唤醒 effect（END 状态不再产生事件）→ 到点强制重查
      const remain =
        errorAtRef.current != null ? ERROR_GRACE_MS - (Date.now() - errorAtRef.current) : 0;
      const timer = setTimeout(() => forceTick((v) => v + 1), Math.max(remain, 0) + 100);
      return () => clearTimeout(timer);
    }
    if (Date.now() - lastFireAtRef.current < MIN_FIRE_GAP_MS) return;
    if (settleTimersRef.current.length > 0) return; // 已有 settle 判定在等待

    const settleAndCheck = (stage: 1 | 2) => {
      const timer = setTimeout(() => {
        settleTimersRef.current = settleTimersRef.current.filter((t) => t !== timer);
        const s = streamRef.current;
        const errorStillInGrace =
          s?.error != null &&
          errorAtRef.current != null &&
          Date.now() - errorAtRef.current < ERROR_GRACE_MS;
        const settled =
          !!s &&
          !s.isLoading &&
          s.interrupt == null &&
          !errorStillInGrace &&
          ranInSessionRef.current &&
          Date.now() - mountedAtRef.current >= HYDRATION_WINDOW_MS &&
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
  }, [
    stream,
    submit,
    stream?.isLoading,
    stream?.interrupt,
    stream?.error,
    stream?.messages,
    graceTick,
  ]);

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
