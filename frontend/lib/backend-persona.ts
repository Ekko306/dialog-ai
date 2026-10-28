"use client";

/**
 * 后端教练人设（role/scenario）与前端角色目录的桥接（2026-10-27 角色人设串台修复）：
 *
 * 根因：后端 talk_agent 图的教练人设存全局单例 Store（coach_context.py 命名空间
 * ("coach_context",) key "current"，跨线程共享），图每次出新话题前经
 * store_resolve_node 读取。前端 12 角色共用同一 talk_agent graph（003 的会话隔离
 * 仅 thread_id，人设不在其范围），任何页面写入的人设都会被其他页面的新话题读到
 * ——实测：主对话场景轮换到「雅思口语考官/Part 1 面试」后，Lisa 页 AutoContinue
 * 续跑出新话题时读到该全局值，出现"我是雅思口语考官"。
 *
 * 修复方式（用户选定：前端映射，零后端改动）：langgraph dev 暴露 Store REST API
 * （PUT /store/items，204），页面挂载时把本页人设写入 Store，保证本页发起的一切
 * 新话题 run（首轮 submit / AutoContinue 续跑 / 新会话）读到正确人设；主对话页
 * 挂载时回写主对话人设（用户上次选场景，缺省 英语口语教练/日常闲聊），双向防串台。
 *
 * 已知取舍（documented tradeoffs）：
 * - 主对话「新会话」的场景轮换（_new_context_）在后端轮换 Store，前端不追踪轮换结果
 *   ——离开主对话再回来会回落到上次弹窗所选场景（或缺省），轮换值不跨页保留。
 * - 写入失败（后端未起/网络抖动）：ensureBackendPersona 返回 false；新会话按钮
 *   中止发指令并提示重试（Store 空 + 静默发指令 = run 读缺省人设"英语口语教练"，
 *   即 2026-10-27 角色页串台复现）；挂载兜底写入忽略返回值，不阻塞渲染。
 * - 后端若把命名空间改为 ("coach_context", user_id)（coach_context.py 生产注释），
 *   本模块的 namespace 需同步调整。
 */
export interface BackendPersona {
  role: string;
  scenario: string;
}

/** 主对话（alicia/Ella）缺省人设 = 后端 DEFAULT_ROLE/DEFAULT_SCENARIO（coach_context.py） */
export const MAIN_DEFAULT_PERSONA: BackendPersona = {
  role: "英语口语教练",
  scenario: "日常闲聊",
};

/**
 * 前端角色 → 后端教练人设映射（roleId 为 key；主对话 alicia 不在此表——其人设
 * 跟随用户选场景，见 role-thread-store.lastMainPersona）。后端 set_context/Store
 * 均接受任意字符串，文案可按产品需要随时调整。
 */
export const ROLE_PERSONAS: Record<string, BackendPersona> = {
  lisa: { role: "英语纠错官", scenario: "中文纠错润色陪练" },
  ella: { role: "零基础英语外教", scenario: "简单慢速日常闲聊" },
  sally: { role: "全英纠错官", scenario: "全英对话纠错" },
  mira: { role: "英语外教", scenario: "轻松趣味闲聊" },
  zora: { role: "中英传译官", scenario: "中英互译练习" },
  david: { role: "英语外教", scenario: "地道表达陪练" },
  dylan: { role: "雅思口语考官", scenario: "Part 1 面试" },
  luke: { role: "俚语分享官", scenario: "每日地道俚语" },
  fiona: { role: "英语语伴", scenario: "轻松日常闲聊" },
  piper: { role: "短语搭配教练", scenario: "地道短语积累" },
  sarah: { role: "词汇教练", scenario: "词根词缀记单词" },
};

// 写入串行队列：快速切换页面时保证后端 Store 最终态 = 最后一次请求的人设
// （PUT 本身幂等，串行只为避免乱序覆盖）
let queue: Promise<boolean> = Promise.resolve(true);

/** 把人设写入后端 Store（每次调用都真实写入，无缓存跳过——后端重启会清空
 *  Store，缓存会留过期状态）。
 *  返回 true = 写入成功；false = 失败（后端未起/网络抖动）。
 *  新会话按钮据 false 中止发指令并提示重试；页面挂载的兜底写入忽略返回值。 */
export function ensureBackendPersona(apiUrl: string, persona: BackendPersona): Promise<boolean> {
  const run = async (): Promise<boolean> => {
    try {
      const res = await fetch(`${apiUrl}/store/items`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          namespace: ["coach_context"],
          key: "current",
          value: { role: persona.role, scenario: persona.scenario },
        }),
      });
      if (!res.ok) {
        console.warn(`[backend-persona] 写入人设失败：HTTP ${res.status}`);
        return false;
      }
      return true;
    } catch {
      console.warn("[backend-persona] 写入人设请求异常");
      return false;
    }
  };
  queue = queue.then(run, run);
  return queue;
}
