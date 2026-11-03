# Research: 004 主窗口-我的（个人中心）

**Date**: 2026-11-02 | **Spec**: [spec.md](spec.md) | **原型图**: `frontend/docs/mockups/子功能-主窗口-我的-个人中心.html`

## R1 入口与页面挂载

- **Decision**: "我的"入口沿用 001 已交付的底部 TabBar（`tab-bar.tsx` L12-16 已定义 `tab3="我的"`，User 图标），`main-tab-shell.tsx` L18 中 `tab3` 当前渲染 `<EmptyTab />`，替换为新建 `MyProfilePage` 组件。原型图中的"左侧栏"仅为区块示意，实际 app shell 以 001 交付的底部 Tab 为准（Constitution III：基于已联调流程增量扩展；Constitution IV：目视比对针对四大区块内容，不含 shell 布局）。
- **Rationale**: TabBar 与切换骨架已存在且验证过，零框架改动；主区域内容严格对照原型图四区块实现。
- **Alternatives**: 按原型图新做左侧栏 → 与 001 既有 shell 冲突，重复建设被否决。

## R2 历史 threads 数据聚合（本功能技术核心）

- **Decision**: 纯 fetch 直连既有 `/api` 代理（`app/api/[..._path]/route.ts` 透传全部方法到 `LANGGRAPH_API_URL`），两步聚合：
  1. `POST /api/threads/search`（body `{ "limit": N }`）→ 最近 thread 列表（按更新时间倒序）；
  2. 对每个 `thread_id` 调 `POST /api/threads/{id}/history`（body `{ "limit": M }`）→ 检查点快照序列，遍历各快照 `values` 收集含 `ise_check_results` 的轮次，直到累计 50 条或线程耗尽。
- **Rationale**: thread 最新 state（`GET /threads/{id}/state`）只含最后一轮，逐词评分需逐轮快照，LangGraph 平台 history 端点是唯一逐轮数据源；代理已支持 POST 转发，无需引入 `@langchain/langgraph-sdk` 新依赖。聚合全部在前端完成（FR-005 后端零改动）。
- **Alternatives**: state 端点（只有末轮，弃）；新增后端聚合接口（违反 FR-005，弃）。
- **字段提取**（各快照 `values`）：`ise_status === "ok"` 且 `ise_check_results` 存在 → 计入轮次；`scores.total` → 综合分；`speed_wpm` → 语速；`pronunciation[]` → 错词本原料。`score` 为百分制、`null` 不计入。

## R3 收藏持久化与双向同步

- **Decision**: 将 `popup-store.ts` 中会话级 `Set<string>`（仅存 polishedText 键）升级为共享收藏存储：新建 `components/pronunciation-popup/favorites-store.ts`，收藏元素升级为 `FavoriteItem { key, style, en, zh, savedAt }`，读写 localStorage + `useSyncExternalStore` 订阅（复用 use-popup-audio 的单例 store 模式）。003 弹窗侧最小回改：`polish-section.tsx` 调 `toggleFavorite` 时多传 `style/en/zh` 三个实参；其余消费方（isFavorite）签名不变。
- **Rationale**: 双向同步要求弹窗与"我的"读写同一数据源 + 跨组件响应式更新，`useSyncExternalStore` 是项目既有模式；localStorage 已在 spec FR-012 定为载体（项目首个使用点）。
- **Alternatives**: 保持内存态单向展示（FR-009 冲突，clarify Q4 已否决）；引入状态库（超需，弃）。

## R4 默认口音接线点（三处）

- **Decision**: 新建设置存储 `lib/profile-settings.ts`（同 R3 模式），`accent: "american" | "british"` 默认 `"american"`。接线：① 003 弹窗示范读音兜底源——`word-analysis-section.tsx` L125 与 `use-popup-audio.ts` `replayLastDemo` 的 fallback accent 改读设置；② 润色区 AI 朗读——`polish-section.tsx` L124 硬编码 `accent: "american"` 改读设置；③ 错词本试听（新代码）直接读设置。英音/美音双按钮本身保留手动切换，设置值仅作默认/兜底。
- **Rationale**: 三处均为"默认选择"语义，读同一 localStorage key 即天然一致；后端 `POST /audio/tts` 已支持 accent 参数，零改动。

## R5 循环跟读默认开关

- **Decision**: `use-popup-audio.ts` 的 `INITIAL_STATE.loop` 由硬编码 `false` 改为模块初始化时读设置存储（一次性读取，弹窗内手动切换不回写设置）。
- **Rationale**: loop 是单例引擎模块级状态，初始化读一次即满足"弹窗内循环跟读初始为开启"（US4 验收 2）；回写会把弹窗内临时操作污染为全局默认。

## R6 TTS 语音输出开关（接线 audio_choice interrupt）

- **Decision**: 后端 `talk_graph.py` `audio_choice_node`（L66-76）是 interrupt 型 HITL，每轮询问"是否将润色结果合成为语音？(yes/no)"，前端经 `tool-fallback.aui.tsx` 的 `respondToApproval` 应答。开关关闭时，前端检测到该 interrupt（按 prompt 文案"是否将润色结果合成为语音"识别）自动应答 `"no"`，跳过询问 UI；开关开启时维持现有人工询问。后端零改动（`enable_tts` 状态键与判定逻辑原样）。
- **Rationale**: 开关语义 = "不想要语音时不再每轮打扰"，关闭态自动应答是纯前端行为；识别用 prompt 文案前缀匹配，脆弱性可接受（该文案为后端既有常量，不跨功能复用）。
- **Alternatives**: 前端拦截音频播放（当前前端不消费 tutor_audio/polished_audio，无处可拦，弃）；改后端读配置（违反零改动，弃）。

## R7 设置与收藏的 localStorage 安全封装

- **Decision**: 统一封装 `safeLocalStorage`（读写均 try/catch），隐私模式/禁用 cookie 时降级为模块内存 Map，行为同 FR-012；key 前缀 `dialog-ai:profile:`。
- **Rationale**: 无既有 localStorage 先例（全仓 0 引用），首个使用点必须自带降级；JSON 解析失败视为损坏按空处理不抛错（FR-013 禁白屏）。

## R8 错词本派生规则复用

- **Decision**: 档位判定复用 `word-marks.ts` 的 `qualityOf` + `QUALITY_THRESHOLDS`（<60 poor、60-85 fair、≥85 good）与 `normalizeWord`（去标点小写）做去重键、`SILENCE_TOKENS` 过滤 sil/sp/pause；聚合模块（新 `lib/profile-aggregate.ts`）不复制阈值常量，直接 import。
- **Rationale**: 单一事实来源，调参一处生效；clarify Q2 已确认 poor+fair 都收。
