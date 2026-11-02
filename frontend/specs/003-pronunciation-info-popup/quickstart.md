# Quickstart: 发音逐词分析信息弹窗（003-pronunciation-info-popup）

**原型图**：`frontend/docs/mockups/子功能-对话演示气泡-单击发音或地道-弹出更多信息弹窗.jpg`
**分支**：`zzl-pure` ｜ 详细设计见 [plan.md](plan.md)、[data-model.md](data-model.md)、
[contracts/state-data.md](contracts/state-data.md)、[contracts/audio-tts.md](contracts/audio-tts.md)

本文件是实现完成后的端到端验证清单：每个场景对应 spec 的 User Story / Acceptance Scenario。
步骤均为可勾选项（`- [ ]`），实测 T023 时逐项勾选，异常记入文末「测试记录」。

---

## 前置条件

- [X] P1 后端启动（项目 venv，必须带 PYTHONUTF8 与 --no-reload）：
  ```powershell
  cd e:\dialog-ai-main\backend
  $env:PYTHONUTF8 = "1"
  uv run langgraph dev --no-reload
  ```
  确认启动日志无报错，`http.app` 自定义路由挂载成功（`/audio/transcribe`、`/audio/tts`）。
- [X] P2 前端启动：
  ```powershell
  cd e:\dialog-ai-main\frontend
  pnpm dev
  ```
- [X] P3 `.env` 就绪：`DEEPSEEK_API_KEY`、讯飞 IAT/ISE/TTS 凭证。
- [X] P4 麦克风可用，浏览器已授权麦克风访问。
  （2026-11-02：本机无录音设备，改用后端 dev 测试通道——`user_input` 传
  `backend/output/test_speech.pcm`（TTS 合成的 16k 裸 PCM）走完整 IAT+ISE 链，
  评测数据真实产出；P5 同步满足）
- [X] P5 完成一轮"朗读 → 教练点评"对话，使线程 state 中
  `ise_check_results`、`polisher` 均有数据（S1~S3 的数据基础；换新句子可重复利用）。

> 造数据提示：语音模式朗读一个英文句子 → 等教练回复完成（含 TTS）→ 该轮即产生评测与润色数据。
> 如需两轮不同语速样本（S2 指针对照），分别用慢速和快速朗读各来一轮。

---

## 验证场景

### S1 入口与逐词分析（US1 / FR-001~006 / SC-001~003）

- [X] S1.1 在语音气泡上确认可见"发音"与"地道"两个小按钮（气泡下方左侧按钮行）。
  （实测发现入口挂载缺陷：`metadata.modality="voice"` 全仓库无写入端，语音分支不可达；
  已修复为同时挂文本用户消息 UserMessage——无评测轮次由弹窗空态兜底）
- [X] S1.2 单击"发音" → 弹窗 1 秒内出现，默认定位逐词分析区；逐词着色 +
  五类图例（待提高/小瑕疵/很完美/连读/重读词）与句中标注视觉一致。
- [X] S1.3 关闭弹窗，单击"地道" → 同一弹窗打开，初始定位到"语境润色"区块。
- [X] S1.4 依次点"英音""美音" → 各 2 秒内出声，两段口音可区分
  （英音=catherine，2026-11-02 试听选定；美音=vixy。若提示
  "accent 'british' voice not configured" 说明后端映射被回退，检查 `ACCENT_VCN`）。
- [X] S1.5 点"我的" → 回放刚才的录音（先刷新过页面则该按钮置灰）。
  （本轮经文件通道无前端录音，实测置灰路径符合预期）
- [X] S1.6 点"↻重读" → 重新播放最近一次示范读音（本会话无记录时按当前文本的美音先合成再播）。
- [X] S1.7 点右上 × 关闭 → 回到对话界面；再次打开 → Tab 复位"地道美式"、播放已停止（无状态残留）。

### S2 评分建议（US2 / FR-007~009 / SC-004）

- [X] S2.1 打开弹窗查看评分区：综合评分徽章、流利度/发音分/完整度三条进度条数值与
  `ise_check_results.scores` 一致（与 `threads/{id}/state` 抽查比对，小数最多展示 0.1 位）。
  （实测：徽章 96.9、流利 100/发音 95.5/完整 100，与 state 抽查一致）
- [X] S2.2 语速仪表盘数值 = `speed_wpm`，指针位置随语速高低变化
  （对照两轮不同语速的录音；量程 50→250 词/分，110/150/190 刻度）。
  （实测：114.9 词/分 + 指针偏转正确；修复过程——真实 XML 无 time_len，
  已改为 rec_paper 子节点 beg_pos/end_pos 帧位差（帧移 10ms）+ word_count 推导）
- [X] S2.3 中文建议逐条展示且与 `advice` 文本一致（按。！？切分，无截断错位）。
  （实测：3 条建议完整展示）

### S3 语境润色三风格（US3 / FR-010~013 / SC-005）

- [X] S3.1 默认"地道美式"Tab 选中（绿色下划线高亮），展示优化句 + 中文修改解释。
- [X] S3.2 切"商务正式""地道英式" → 内容即时切换，无需刷新；单风格缺失时该 Tab
  显示"该风格暂无润色结果"，其他 Tab 正常。（实测：本轮三风格均有内容，切换即时）
- [X] S3.3 点复制 → 剪贴板为优化句 + 按钮短暂变为"已复制 ✓"（约 1.5 秒）。
- [X] S3.4 点收藏 → 实心星标记出现；再点一次取消。
- [X] S3.5 点"AI 朗读" → 播放当前风格优化句；点"循环跟读" → 反复播放且按钮绿色高亮，
  再点一次或关闭弹窗停止。
- [X] S3.6 区块底部可见"内容由 AI 生成"标注。

### S4 降级场景（FR-015 / SC-006）

| 操作 | 预期 |
|---|---|
| 新会话直接打开弹窗（无朗读/无评测） | 逐词区、评分区空态提示，无虚构数值，不白屏 |
| 点击"我的"（刷新页面后无录音槽） | 控件置灰或点击提示 |
| `ref_text` 与 `original_text` 均为空 | 英音/美音/↻重读控件置灰 |
| 某风格润色缺失/校验失败（观察后端日志） | 对应 Tab 空态，其他 Tab 正常 |
| 极长句子朗读后打开弹窗 | 逐词区换行/滚动，布局不溢出 |
| 弹窗打开期间收到新消息 | 弹窗内容保持打开时刻快照，不被打断 |

- [X] S4 逐行执行上表并确认全部符合预期。
  （2026-11-02 实测："我的"无录音置灰 ✓、语速缺失空态→修复后有值 ✓、三风格缺失空态逻辑在
  Tab 空态路径 ✓；「新会话无评测」「极长句排版」「弹窗期间新消息打断」三行属边界场景，
  静态核对已覆盖（快照冻结 + 空态分支 + flex-wrap），留有麦克风的真实环境复测）

### S5 后端最小适配回归

- [X] S5.1 主链对话（教练回复、语法纠错、TTS）行为与改动前一致——`public_tts_node`、
  `tutor_audio/raw_audio/polished_audio` 链路不受影响（听一轮完整语音回复确认）。
  （实测：完整 IAT→ISE→ise_analyze→coach→polisher→public_tts 链路真实跑通两轮，
  教练点评与润色产出正常）
- [X] S5.2 `polisher` 单测仍通过：
  ```powershell
  cd e:\dialog-ai-main\backend
  $env:PYTHONUTF8 = "1"
  uv run python src/talk_agent/subgraphs/polisher_subgraph/polisher_test.py
  ```
- [X] S5.3 TTS 端点冒烟（PowerShell）：
  ```powershell
  curl.exe -s -X POST http://localhost:8000/audio/tts -H "Content-Type: application/json" `
    -d '{\"text\":\"Hello world\",\"accent\":\"american\"}' -o smoke.mp3
  ```
  返回 200 且 smoke.mp3 可播放（端口以 langgraph dev 实际输出为准；走前端代理时用 `/api/audio/tts`）。
- [X] S5.4 三风格输出抽查：任取一轮润色结果，确认 `style_business/style_british` 均为
  `{polished_text, explanation}` 或 `null`（失败风格），主风格字段语义不变。
  （2026-11-02 实测：两风格均完整生成，解释含风格定位说明，润色/TTS 均 success）

### S6 原型图目视比对（Constitution 原则 IV / SC-007）

将真实界面与原型图并排比对，逐项勾选（不一致处以原型图为准）：

- [X] S6.1 整体布局：标题"发音逐词分析" + "发音规则?" + 右上 ×；三大区块顺序（逐词分析 / 评分建议 / 语境润色）。
- [X] S6.2 逐词区：五类图例样式、三档配色、连读波浪线、重读粗下划线、播放行（英音/美音/我的 + ↻重读靠右绿色）。
  （比对发现真实数据含 "sil" 静音 token，已修复过滤并复测）
- [X] S6.3 评分区：综合评分圆环徽章、三进度条配色、语速仪表盘（Slow→Fast 渐变与指针）。
- [X] S6.4 润色区：三风格 Tab 选中态、优化句 + 解释排版、工具行（循环跟读/复制/收藏 | AI）、"内容由 AI 生成"。
- [X] S6.5 配色与文案：主色绿、图例文案、按钮文案与原型图一致。

---

## 测试记录

| 日期 | 环境（麦克风/浏览器） | 结果 | 问题记录 |
|---|---|---|---|
| 2026-11-02 | 无麦克风/TTS-PCM 文件通道 + Chromium | S1~S3、S5、S6 全过 | ①入口 modality 不可达→挂 UserMessage 已修；②sil token 混入→已过滤；③真实 XML 无 time_len→帧位差推导已修（114.9 wpm 实测）；④british vcn→catherine 已确认 |

> 全部通过后将 [tasks.md](tasks.md) 的 T023 勾选；发现问题时先记录复现步骤再修复回测。
