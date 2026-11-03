# Implementation Plan: 主窗口-我的（个人中心）（004-my-profile）

**Branch**: `004-my-profile`（实际工作分支：`zzl-pure`） | **Date**: 2026-11-02 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/004-my-profile/spec.md`
**原型图（需求与验收视觉基准）**: `frontend/docs/mockups/子功能-主窗口-我的-个人中心.html`（四大区块内容为目视比对基准；入口沿用 001 底部 TabBar，见 research R1）

## Summary

主区域新增"我的"个人中心页（挂载于 001 既有底部 TabBar 的 `tab3`，替换 EmptyTab），四大区块：学习概览（三统计卡 + 最近 5 轮趋势）、错词本（poor+fair 按频次降序 + 单词试听）、我的收藏（localStorage 持久化 + 与 003 弹窗双向同步）、设置（默认口音/循环跟读默认开启/TTS 语音输出开关）。全部数据前端聚合：经既有 `/api` 代理调 LangGraph `threads/search` + `threads/{id}/history` 收集最近 50 条含评测轮次（R2），后端零改动；收藏与设置为 localStorage 存储（`useSyncExternalStore` 单例 store 模式，隐私模式降级内存态）；TTS 开关经自动应答 `audio_choice_node` interrupt 生效（R6）。

## Technical Context

**Language/Version**: 前端 TypeScript（Next.js 16 + React 19）；后端零改动（LangGraph dev 仅作为数据源）

**Primary Dependencies**: `@assistant-ui/react`（runtime 已就绪）、React 19 `useSyncExternalStore`（store 模式）、Tailwind 4 + lucide-react、原生 fetch（threads REST）；复用 003 `POST /api/audio/tts`、`use-popup-audio` 单例播放模式、`word-marks.ts` 档位常量

**Storage**: localStorage（收藏 + 设置；隐私模式降级内存态，FR-012）；LangGraph 检查点（sqlite，既有）作为历史轮次只读数据源

**Testing**: `pnpm lint`（oxlint/oxfmt）+ `tsc --noEmit` + `pnpm build` + 浏览器实测（含 localStorage 双向同步、刷新持久化）；聚合单元可经浏览器 console 注入 mock 或既有 threads 实测

**Target Platform**: 桌面/移动浏览器（Next dev，localhost 或局域网 https）

**Performance Goals**: Tab 切换 1s 内出骨架（SC-001）；50 条轮次聚合 3s 内完成（SC-002）；设置改动即时生效（SC-005）

**Constraints**: 后端零改动（FR-005，Constitution 原则 II）；缺失数据空态/占位不虚构（FR-013）；localStorage 不可用降级不阻塞（FR-012）；改动仅推送 `zzl-pure` 分支；003 弹窗回改仅限收藏字段传参扩列与两处 accent/loop 读取点（Constitution III 增量扩展边界内）

**Scale/Scope**: 前端新增 1 页面目录（components/my-profile/）+ 3 个共享 store/lib 模块；003 侧小改 3 文件（polish-section / word-analysis-section+use-popup-audio / popup-store 拆出收藏）；后端 0 文件

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 原则 | 结论 | 依据 |
|---|---|---|
| I. assistant-ui 框架规范优先 | ✅ PASS | 页面挂载复用 001 既有 MainTabShell/TabBar 骨架；不绕开 runtime 自建会话流；历史数据走 LangGraph 平台标准 REST（threads/search、threads/{id}/history），是官方数据面用法 |
| II. 前端适配后端，后端最小改动 | ✅ PASS | **后端零改动**（FR-005）：历史数据读既有检查点历史，TTS 开关经前端自动应答既有 interrupt（R6），试听/AI 朗读复用既有 `POST /audio/tts`；003 前端回改清单已在 research R3/R4/R5 限定为收藏传参扩列 + 2 处 accent/loop 读取点，属增量扩展非重构 |
| III. 现有数据结构复用，读取展示优先 | ✅ PASS | 聚合原料全部为既有 OverAllState 快照字段（ise_check_results/ise_grade/speed_wpm/raw_text），不新增后端数据结构；档位判定/词干归一/静音过滤复用 word-marks.ts 常量；派生（统计卡、错词本合并、趋势）全在前端视图层 |
| IV. 原型图驱动开发 | ✅ PASS | 本 plan/research/data-model/contracts/quickstart 均引用原型图路径；quickstart S6 为四区块目视比对步骤；原型图中"左侧栏"经 R1 裁决为区块示意（实际入口用 001 底部 Tab），比对聚焦区块内容 |

**Post-Phase 1 复核**: 设计未引入新依赖（原生 fetch + localStorage）、未改动后端、003 回改限于字段传参与默认值读取 → 四原则维持 PASS，无 Complexity Tracking 项。

## Project Structure

### Documentation (this feature)

```text
frontend/specs/004-my-profile/
├── plan.md                    # 本文件（/speckit-plan 输出）
├── research.md                # Phase 0：R1~R8 研究决策
├── data-model.md              # Phase 1：聚合视图模型 + 本地存储实体
├── contracts/
│   ├── threads-api.md         # threads/search + threads/{id}/history 数据面契约
│   └── local-storage.md       # 收藏/设置 localStorage key 与读写契约
├── quickstart.md              # 端到端验证清单
└── tasks.md                   # Phase 2 输出（/speckit-tasks 生成，本阶段不创建）
```

### Source Code (repository root)

```text
backend/                                        # 零改动（FR-005）
frontend/
├── app/                                        # 不改（runtime / /api 代理已就绪）
├── lib/
│   ├── profile-settings.ts                     # ★新增：设置 store（accent/loop/ttsEnabled，localStorage + 降级）
│   └── profile-aggregate.ts                    # ★新增：threads 聚合纯函数（轮次收集/统计卡/错词本/趋势）
├── components/
│   ├── main-tab-shell.tsx                      # ★tab3 分支替换 EmptyTab → MyProfilePage
│   ├── my-profile/                             # ★新功能目录（本功能主体，全部新增）
│   │   ├── my-profile-page.tsx                 # 页面容器（加载态/错误重试/四区块布局，对照原型图）
│   │   ├── overview-section.tsx                # 三统计卡 + 最近 5 轮柱状趋势
│   │   ├── weak-words-section.tsx              # 错词本（频次降序 + 🔊 试听）
│   │   ├── favorites-section.tsx               # 收藏列表（风格/英文/中文 + 复制/AI 朗读/取消收藏）
│   │   └── settings-section.tsx                # 三行设置（口音分段/循环跟读/TTS 开关）
│   └── pronunciation-popup/                    # 003 侧最小回改（Constitution III 边界内）
│       ├── popup-store.ts                      # ★收藏 Set 移出（快照类型保留），文件头契约注释更新
│       ├── favorites-store.ts                  # ★新增：收藏 store（FavoriteItem + localStorage + 订阅）
│       ├── polish-section.tsx                  # ★toggleFavorite 传参扩列（style/en/zh）+ AI 朗读 accent 读设置
│       ├── word-analysis-section.tsx           # ★示范读音兜底 accent 读设置
│       ├── use-popup-audio.ts                  # ★loop 初值读设置；replayLastDemo fallback accent 读设置
│   ├── tool-fallback.aui.tsx                   # ★TTS 开关关闭时自动应答 audio_choice interrupt（R6，位于 components/ 根）
└── specs/004-my-profile/                       # 本功能设计产物（见上）
```

**Structure Decision**: 沿用 monorepo 既有 `frontend/` 单端结构（本功能后端零改动）。页面组件收在 `components/my-profile/` 独立目录（与 pronunciation-popup/ 同构）；跨弹窗与页面共享的设置/收藏/聚合逻辑放 `lib/` 纯模块，UI 组件不直接触 localStorage，便于测试与降级替换。

## Complexity Tracking

> Constitution Check 四原则全部 PASS，无违规项，本表留空。

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| N/A | N/A | N/A |
