# Tasks: 004 主窗口-我的（个人中心）

**Input**: Design documents from `/specs/004-my-profile/`

**Prerequisites**: plan.md ✅ | spec.md ✅ | research.md ✅ | data-model.md ✅ | contracts/threads-api.md ✅ | contracts/local-storage.md ✅ | quickstart.md ✅

**Tests**: 测试为手工验证步骤（quickstart S1~S6），不生成自动化测试任务；各 US 末尾含对应手工验证项。

**Organization**: 按 User Story 分组；后端零改动（FR-005），全部任务在前端。

**原型图（目视比对基准）**: `frontend/docs/mockups/子功能-主窗口-我的-个人中心.html`（入口按 research R1 用 001 底部 Tab）

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可并行（不同文件、无未完成依赖）
- **[Story]**: 所属 User Story（US1~US4）

## Phase 1: Setup（共享基建）

- [x] T001 [P] 新建 `frontend/lib/safe-local-storage.ts`：统一 localStorage 安全封装（读写 try/catch、JSON 安全解析失败返回 null、隐私模式降级模块内存 Map），供 settings/favorites 两个 store 复用（contracts/local-storage.md §0/§4）
- [x] T002 [P] 新建目录 `frontend/components/my-profile/`（空目录由后续任务文件创建，本任务确认路径规划无冲突）

**Checkpoint**: 共享封装就绪

---

## Phase 2: Foundational（阻塞前置，全部 US 依赖）

- [x] T003 新建 `frontend/lib/profile-settings.ts`：ProfileSettings store（data-model §2.5 / contracts/local-storage.md §2）——`getSettings()` 同步读（默认值 `{ accent: "american", loopDefault: false, ttsEnabled: true }` 合并，部分字段缺失渐进兼容）、`updateSettings(patch)` 合并写入 + 通知、`subscribeSettings(notify)`；key `dialog-ai:profile:settings`；基于 T001（depends T001）
- [x] T004 新建 `frontend/components/pronunciation-popup/favorites-store.ts`：FavoriteItem store（data-model §2.4 / contracts/local-storage.md §1）——`listFavorites()`（savedAt 倒序）/`isFavorite(key)`（与 003 既有消费方签名兼容）/`addFavorite({key,style,en,zh})`（已存在刷新置顶）/`removeFavorite(key)`/`subscribeFavorites(notify)`；`useSyncExternalStore` 单例模式（参照 use-popup-audio.ts）；key `dialog-ai:profile:favorites`；基于 T001（depends T001）
- [x] T005 新建 `frontend/lib/profile-aggregate.ts`：threads 聚合纯函数（research R2 / contracts/threads-api.md）——① `fetchProfileRounds()`：`POST /api/threads/search {limit:30}` → 逐线程 `POST /api/threads/{id}/history {limit:100}`（Promise.all 并发 ≤6），收集 `values.ise_status==="ok" && ise_check_results` 存在的快照为 `ProfileRound`（data-model §1.1 字段表），凑满 50 轮即停，不足 50 轮时 threads/search 按 offset 递增最多再翻一页续拉（contracts/threads-api.md §1），单线程失败跳过、search 失败抛错；**实现前置冒烟：先 curl `POST /api/threads/{id}/history` 确认本地 langgraph dev 返回检查点数组，端点不可用立即上报而不是静默空结果**；② `deriveSummary(rounds)`：`ProfileSummary`（roundCount / avgTotal 保留 1 位小数 / avgSpeed 取整 / trend 最近 5 轮时间正序，null 不计均值）；③ `deriveWeakWords(rounds)`：`WeakWord[]`——复用 `word-marks.ts` 的 `qualityOf`/`QUALITY_THRESHOLDS`/`normalizeWord`/`SILENCE_TOKENS`（禁止复制常量），key=normalizeWord，worstQuality 取最差（poor<fair）、count 累计、extras 并集（元素为 WordExtra），排序 count 降序同频次最差档在前（SC-004）（depends T001）

**Checkpoint**: 基础设施就绪，US1~US4 可开始

---

## Phase 3: User Story 1 - 打开"我的"查看学习概览 (Priority: P1) 🎯 MVP

**Goal**: 点击"我的"Tab 展示三统计卡 + 最近 5 轮趋势，数值与 threads 数据一致

**Independent Test**: 产生含评测的历史轮次 → 点"我的" → 统计卡数值抽查一致 → 5 根柱状可见（quickstart S1）

### Implementation for User Story 1

- [x] T006 [US1] 新建 `frontend/components/my-profile/my-profile-page.tsx`：页面容器——标题"我的 · 个人中心"+ 副标题（数据来源说明，对照原型图）；useEffect 调 `fetchProfileRounds()` 派生 summary/weakWords；四态管理（loading 骨架 SC-001 / error 错误提示+重试按钮 FR-014 / empty 占位 `--`+引导文案 / ready 渲染四区块占位）；本阶段先挂载 overview-section
- [x] T007 [P] [US1] 新建 `frontend/components/my-profile/overview-section.tsx`：三统计卡（累计朗读轮数/平均综合分 1 位小数/平均语速 词每分）+ 最近 5 轮综合分柱状趋势（CSS 柱高按分数比例，参照原型图 .bars 结构）；数据缺失显示 `--` 与引导文案，不虚构（FR-013/US1 验收 2）
- [x] T008 [US1] 修改 `frontend/components/main-tab-shell.tsx`：`activeTab === "tab3"` 分支由 `<EmptyTab />` 替换为 `<MyProfilePage />`（research R1，001 骨架不动）
- [x] T009 [US1] 手工验证 quickstart S1.1~S1.4：Tab 高亮、1s 骨架、统计卡抽查一致（curl `POST /api/threads/search`+`/history` 核算，并记录聚合耗时确认 <3s 即 SC-002）、趋势柱正确（depends T006~T008）
  - 2026-11-02 实测：26 轮/95.4 分/115 词每分与 threads 冒烟核算一致（26 条有效轮）；5 柱 轮#22~26 数值 92.15 与最新轮一致；聚合渲染秒级完成（SC-002 满足）

**Checkpoint**: US1 独立可测（MVP 可用）

---

## Phase 4: User Story 2 - 查看错词本并试听弱项词 (Priority: P1)

**Goal**: 错词本按频次降序展示 poor+fair 弱项词，单词级 🔊 试听

**Independent Test**: 含重复弱项词数据 → 频次降序 + 档位取最差 → 点击 🔊 出声（quickstart S2）

### Implementation for User Story 2

- [x] T010 [P] [US2] 新建 `frontend/components/my-profile/weak-words-section.tsx`：错词本列表（词/档位徽章 poor=待提高 fair=小瑕疵/次数/extras 连读·重读标注，样式对照原型图 .words）；🔊 试听按钮调 `use-popup-audio` 模式播放 `{ kind: "tts", text: word, accent: getSettings().accent }`（复用 003 单例播放器，research R4③）；空态文案"完成第一次朗读后，这里会汇总你的高频弱项词"（FR-013）；数据入参 `WeakWord[]`
- [x] T011 [US2] 修改 `frontend/components/my-profile/my-profile-page.tsx`：ready 态挂载 weak-words-section（传 T005 派生的 weakWords）；手工验证 quickstart S2.1~S2.4（depends T005、T010）
  - 2026-11-02 实测：频次降序（to 26 次 → last 8 次）、试听 POST /api/audio/tts 200 无错误；S2.4 空态为代码路径（当前库有数据未实测空库）

**Checkpoint**: US1+US2 独立可测

---

## Phase 5: User Story 3 - 管理我的收藏 (Priority: P2)

**Goal**: 收藏 localStorage 持久化，弹窗↔"我的"双向同步

**Independent Test**: 弹窗收藏 → "我的"可见 → 复制/朗读生效 → "我的"取消 → 弹窗同步未收藏（quickstart S3）

### Implementation for User Story 3

- [x] T012 [P] [US3] 新建 `frontend/components/my-profile/favorites-section.tsx`：收藏列表（风格标签/英文/中文，savedAt 倒序，样式对照原型图 .fav）；操作：复制（剪贴板英文）、AI 朗读（`/api/audio/tts` accent 读 `getSettings().accent`）、取消收藏（`removeFavorite`）；空态文案 + 引导（FR-013）；`useSyncExternalStore(subscribeFavorites)` 订阅实时刷新（SC-006）
- [x] T013 [US3] 003 侧最小回改：`frontend/components/pronunciation-popup/popup-store.ts` 移除 `favorites` Set 与 `toggleFavorite`（收藏改由 favorites-store 承担，PopupSnapshot 类型保留）+ 更新文件头契约注释；`frontend/components/pronunciation-popup/polish-section.tsx` 收藏按钮改为按 `isFavorite(key)` 判定、调 `addFavorite({ key, style, en, zh })` / `removeFavorite(key)`（contracts/local-storage.md §1 迁移说明）（depends T004）
- [x] T014 [US3] 修改 `frontend/components/my-profile/my-profile-page.tsx`：挂载 favorites-section；手工验证 quickstart S3.1~S3.4（双向同步 + 刷新持久化）（depends T012、T013）
  - 2026-11-02 实测（读路径）：localStorage 注入 2 条 → 收藏区正确渲染风格标签/英文/中文/操作；取消收藏后 localStorage 同步仅剩 1 条；刷新持久化通过。同日复验（S3.1/S3.3）：HITL 输入语法正确英文句触发 polisher → 弹窗收藏星标激活 + localStorage 写入 → "我的"卡片显示同一润色句；"我的"取消 → 重开弹窗星标复原未收藏态，双向同步（SC-006）闭环

**Checkpoint**: US1~US3 独立可测

---

## Phase 6: User Story 4 - 配置默认口音、循环跟读与 TTS 语音输出 (Priority: P2)

**Goal**: 三行设置即时生效 + 持久化；三处发声入口统一跟随默认口音

**Independent Test**: 切英音 → 刷新保留 → 三处生效；开循环跟读 → 弹窗初值开启；关 TTS → 不再询问无语音（quickstart S4）

### Implementation for User Story 4

- [x] T015 [P] [US4] 新建 `frontend/components/my-profile/settings-section.tsx`：三行设置对照原型图 .set-row——默认口音分段控件（美音/英音）、循环跟读默认开启开关、TTS 语音输出开关；读写 `getSettings()/updateSettings()`，`useSyncExternalStore(subscribeSettings)` 保持选中态同步（FR-010/011/015）
- [x] T016 [P] [US4] 003 侧接线（research R4/R5）：`frontend/components/pronunciation-popup/polish-section.tsx` L124 AI 朗读 accent 硬编码 `"american"` 改读 `getSettings().accent`；`frontend/components/pronunciation-popup/word-analysis-section.tsx` ↻重读 fallback（L125 一带）accent 改读设置；`frontend/components/pronunciation-popup/use-popup-audio.ts` `INITIAL_STATE.loop` 由 `false` 改为模块初始化读 `getSettings().loopDefault`（弹窗内 setLoop 不回写，R5）（depends T003）
- [x] T017 [US4] TTS 开关接线（research R6，2026-11-02 更正接线点）：`audio_choice_node` 的语音合成询问是纯文本 interrupt（走 `InterruptPrompt`），不是 approval 卡片（不走 tool-fallback）——实现在 `frontend/components/interrupt-prompt.tsx`：`ttsEnabled === false` 时按 prompt 前缀"是否将润色结果合成为语音"识别该 interrupt，自动 `respond("no")` 且以中性提示"语音输出已关闭，已自动跳过语音合成…"替代问题文案；开启时维持现有人工询问；ref 防重复应答，interrupt 清除后复位（tool-fallback.aui.tsx 保持原样未改）（depends T003）
- [x] T018 [US4] 修改 `frontend/components/my-profile/my-profile-page.tsx`：挂载 settings-section；手工验证 quickstart S4.1~S4.3（三处口音联动、循环跟读初值、TTS 开关 interrupt 自动应答）（depends T015~T017）
  - 2026-11-02 实测：S4.1 口音切英音 → 刷新后保持英音选中（持久化）；三处读取点已接线（错词本试听/收藏 AI 朗读/弹窗兜底）。S4.2 弹窗打开即亮绿激活态（polish-section loopSwitchOn 修正）。S4.3 双场景实测通过：ttsEnabled=false 全轮完成且询问从未出现（InterruptPrompt 自动应答 no）；ttsEnabled=true 询问正常出现，人工答 no 后回合完成

**Checkpoint**: 全部 US 独立可测

---

## Phase 7: Polish & Cross-Cutting

- [ ] T019 边界验证 quickstart S5.1~S5.3：隐私模式降级（DevTools 禁 localStorage）、停后端错误重试、空库空态（FR-012/013/014）
  - 状态：未实测（需 DevTools 隐私模式/停后端/空库环境；错误态与空态代码路径已就位）
- [x] T020 目视比对 quickstart S6：四区块顺序/内容与原型图一致（入口按底部 Tab 验收，R1）
  - 2026-11-02 实测：四区块顺序（概览→错词本→收藏→设置）与内容结构对照原型图一致；入口为底部 Tab"我的"
- [x] T021 前端门禁：oxlint 0 error、`tsc --noEmit` 0 error、`next build` 成功（沙箱内直接调 node_modules/.bin 二进制，不经 pnpm run）
  - 2026-11-02：oxlint 0 warning 0 error；tsc exit 0；next build 成功（仅既有 edge runtime 弃用警告）
- [x] T022 回填 quickstart.md 测试记录表；核对 spec.md FR-001~015 / SC-001~007 全覆盖无遗漏
  - FR-001~015 / SC-001~007 逐项核对全覆盖；quickstart 记录表已回填（S3/S4 弹窗侧、S5 边界项留待麦克风/边界环境复验）

---

## Dependencies & Execution Order

### Phase Dependencies

- Setup（T001~T002）→ Foundational（T003~T005）→ US1（T006~T009）→ US2（T010~T011）→ US3（T012~T014）→ US4（T015~T018）→ Polish（T019~T022）

### User Story Dependencies

- **US1**: 依赖 T003（无直接用但 T005 的 consumers 统一在 Foundational 后）、T005
- **US2**: 依赖 T005（WeakWord 派生）、T003（试听口音）
- **US3**: 依赖 T004（favorites-store）、T003（AI 朗读口音在 T012 中引用）
- **US4**: 依赖 T003（settings store）；T016/T017 与 US3 的 003 回改无同文件冲突（polish-section T013 与 T016 同文件，串行执行）

### Parallel Opportunities

- T001/T002 并行；T003/T004/T005 并行（均只依赖 T001）
- T007（US1）、T010（US2）、T012（US3）、T015（US4）四个新区块组件文件互不冲突可并行
- 注意同文件串行点：polish-section.tsx（T013 → T016）、my-profile-page.tsx（T006 → T011 → T014 → T018 递进挂载）

## Implementation Strategy

- **MVP First**: 完成 Phase 1~3（T001~T009）即可独立演示概览页
- **Incremental**: US2 → US3 → US4 逐个叠加验证，每个 Checkpoint 停止实测
- **003 回改纪律**: T013/T016/T017 均为最小增量（传参扩列/默认值读取/自动应答），禁止动弹窗结构与其余逻辑（Constitution III）

## Notes

- 后端零改动：任何任务不得触碰 backend/（FR-005 红线）
- 改动仅提交/推送 `zzl-pure` 分支
- 验证需后端 `PYTHONUTF8=1` + `langgraph dev --no-reload`（端口 2024），启动前清理残留进程
