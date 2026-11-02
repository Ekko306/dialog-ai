# Research: 发音逐词分析信息弹窗（003-pronunciation-info-popup）

**原型图**：`frontend/docs/mockups/子功能-对话演示气泡-单击发音或地道-弹出更多信息弹窗.jpg`
**日期**：2026-10-27 ｜ **分支**：zzl-pure（实际工作分支）

> 本文件汇总 Phase 0 研究结论。所有 NEEDS CLARIFICATION 已解决；标注
> NEEDS EXTERNAL CONFIRMATION 的项为「实现期需用真实环境验证的外部事实」，
> 不阻塞设计，均有降级路径兜底。

---

## R1. 前端如何读取后端 State 数据（弹窗数据主链路）

**Decision**: 前端用 `useLangChainState<T>(key)`（`@assistant-ui/react-langchain`）直接读取
LangGraph 线程 state 的自定义 key，作为弹窗的数据快照来源。

**Rationale**:
- 已验证依赖包类型定义：`node_modules/@assistant-ui/react-langchain/dist/hooks.d.ts:83-84`
  导出 `useLangChainState<T>(key, defaultValue?)`，注释明确"Mirrors `useStream().values[key]`"，
  即 LangGraph 每轮 run 的 values 快照会流到前端，任意 OverAllState key 均可读取。
- 项目已在用同族 hooks（`useLangChainStream/Submit/Respond/InterruptState`，
  见 `frontend/components/talk-flow.tsx:4-7`、`frontend/components/interrupt-prompt.tsx:4`），
  无需新增运行时适配。
- 弹窗"打开时刻数据快照"语义与 `values` 快照天然一致（spec Assumptions）。

**Alternatives considered**:
- 自建 REST 接口按 threadId 查 state（`threads/{id}/state`）：需要额外请求层与线程 ID 管理，
  且语音 bytes 大字段走该通道代价高，放弃。
- 经 `useStreamContext` 自行拼装：非官方推荐路径，代码量更大。

**结论（弹窗消费的 state key 清单）**：
| Key | 用途 | 现状 |
|---|---|---|
| `ise_check_results` | 逐词标注 + 建议 + 评分（R3 扩展后） | 已存在 |
| `ise_grade` | 综合评分徽章兜底 | 已存在 |
| `ref_text` | 英音/美音示范读音文本源 | 已存在 |
| `polisher` | 三风格润色（R6 扩展后） | 已存在 |
| `ise_status` | 无评测数据空态判定 | 已存在 |

---

## R2. 逐词五类标注（待提高/小瑕疵/很完美/连读/重读词）的数据映射

**Decision**: 前端视图层做两级推导，后端零改动：
1. **三档质量**（待提高/小瑕疵/很完美）：由 `ise_check_results.pronunciation[].score`
   （已归一化百分制）阈值映射——`score < 60` 待提高、`60 ≤ score < 85` 小瑕疵、
   `score ≥ 85` 很完美；`score == null`（无逐词分）不标注。阈值放前端常量，便于调参。
2. **连读 / 重读词**：当前讯飞 ISE 产出（`ise_xml_info` XML 与 LLM 逐词点评）无原生的
   连读/重读标注字段，采用二级推导——`comment` 中文点评含"连读"→ 连读标记、
   含"重读"→ 重读词标记（ise_analyze_node 的 ANALYZE_PROMPT 已要求点评指出具体问题，
   关键词命中是合理近似）。未命中则该词无此两类标注。

**Rationale**:
- `backend/src/talk_agent/subgraphs/grammar_check_subgraph/ise_analyze_node.py:46-61`
  `PronunciationItem = {word, score, comment}`；`:80-123` `parse_ise_xml` 产出的 word 级
  字段只有 `word/pinyin/score/flags`（flags 为 增读/漏读/回读/替换/音素异常，非连读/重读）。
- Constitution 原则 III：转换/派生逻辑尽量在前端视图层完成。
- 图例五项仍按原型图完整渲染；连读/重读仅在有命中时出现标注，属于 FR-015 诚实降级。

**Alternatives considered**:
- 后端在 `parse_ise_xml` 增加"从 XML 提取重读/连读"：标准 read_sentence XML 无此数据，硬造会
  违反"不虚构数值"。
- 让 LLM 在 comment 之外输出结构化 stress/liaison 字段：改 LLM 契约超出"最小适配"，
  且可靠性无保证。

**NEEDS EXTERNAL CONFIRMATION**: 实现期用真实 `ise_xml_info` 样本核对是否存在
stress/重读相关属性；若发现可用字段，再升级为前端解析 XML 提取（阈值常量预留扩展位）。

---

## R3. 评分建议区块的数据来源（综合评分/三维度/语速/建议文本）

**Decision**: 后端对 `ise_check_results` 做**确定性字段透出**（Constitution 原则 II 明确允许的
最小适配）：`ise_analyze_node` 成功路径的返回 dict 在现有
`{"pronunciation": [...], "advice": str}` 基础上追加：

```python
"scores": {"total": 70.0, "accuracy": 71.0, "fluency": 62.0, "integrity": 100.0},
"speed_wpm": 78.0,   # 依据 XML time_len + 逐词数推导；解析不出为 None
```

- 四项分数：`parse_ise_xml` 已解析（`ise_analyze_node.py:114-121`），只是此前仅喂 LLM 摘要，
  现在原样透出，零新计算。
- 语速：讯飞 ISE 英文引擎 XML rec_paper 子节点带 `time_len`（音频时长 ms），
  `speed_wpm = 词数 / (time_len/60000)`，确定性推导；XML 无 time_len 或为 0 时置 None。
- 前端展示优先级：`scores.total` 缺失时回退 `ise_grade`；`speed_wpm` 为 None 时
  语速仪表盘显示空态（FR-015）。

**Rationale**:
- 复用既有解析器（不重复实现，原则 III）；纯字段透出，不改节点判定逻辑与图结构。
- 前端直接消费结构化数据，避免在浏览器里二次解析含时间戳噪音的大段 XML。

**Alternatives considered**:
- 前端用 DOMParser 解析 `ise_xml_info`：可行但重复实现后端已有解析逻辑，且把噪音 XML 拉进
  视图层；放弃。
- LLM 额外输出 scores：分数必须与 XML 完全一致（SC-004），LLM 转抄不可靠；放弃。

---

## R4. "我的"播放源（用户本轮录音回放）

**Decision**: 纯前端方案——`serverDictationAdapter`（模块级单例，`frontend/components/server-dictation-adapter.ts:264`）
在 `finishStopped` 成功路径把本轮 Int16 PCM 暂存到模块级内存槽（只保留最近一轮，
新录音覆盖），弹窗"我的"按钮从该槽读取并转成 WAV Blob URL 播放。

**Rationale**:
- 录音 PCM 本来就在前端产生（`frames` → Int16 PCM → POST /api/audio/transcribe），
  就地保留一份即得，后端零改动（原则 II/III 双合规）。
- 与 spec Assumptions 一致：弹窗展示"打开时刻"快照；历史气泡/刷新后无录音 → 空态降级，
  与收藏功能的内存态边界一致。
- 规避经 LangGraph state 透出 `audio_data` bytes 的问题：bytes 随 values 反复序列化
  开销大且格式不可控。

**Alternatives considered**:
- 后端加"取录音"接口读 state 的 `audio_data`：bytes 序列化格式（base64/lc 结构）不可控，
  且引入新接口；放弃。
- 前端 MediaRecorder 存 webm：与现有 PCM 采集链路重复，放弃。

---

## R5. 英音/美音示范读音 + ↻重读 + 润色 AI 朗读（TTS 按需合成）

**Decision**:
1. 后端在 `backend/src/webapp.py` 新增 `POST /audio/tts`：请求 `{text, accent}`，
   响应 MP3 二进制（`audio/mpeg`）。复用现有自定义路由模式（与 `/audio/transcribe`
   同文件同风格，`anyio.to_thread.run_sync` 包同步 SDK）。
2. `xfyun_tts_tool_by_text`（`backend/src/tools/audio_tool/xfyun_tts/xfyun_tts_tool.py:25`）
   增加 `vcn` 可选参数（默认行为不变，`os.getenv("TTS_VCN", "vixy")` 兜底）——
   这是"参数透出"级最小适配；SDK 已支持任意 vcn 透传
   (`xfyunsdkspeech/tts_client.py:129-149, 175-199` `_build_param` 写入 `business.vcn`)。
3. 口音映射：`american → vixy`（默认值，代码内已验证）；`british → 英音发音人 vcn`
   **NEEDS EXTERNAL CONFIRMATION**——讯飞控制台可用的英文英音发音人需在实现期试听确认；
   映射表放常量，未知/不可用口音按 FR-015 置灰降级。
4. 前端：英音/美音/↻重读/AI 朗读/循环跟读全部走 `/audio/tts`（循环跟读 = 前端
   `audio.loop` 开关，不重复请求）；↻重读 = 重放最近一次示范音频（同缓存）。
5. 示范读音文本源：`ref_text`（教练预设参考句）；`ref_text` 为空时回退
   `polisher.original_text`；两者皆空 → 播放控件置灰（FR-015）。

**Rationale**:
- 按需合成走轻量 HTTP，比"submit 一个特殊 run 让图合成"轻得多（不打扰对话流，
  不产生幽灵消息）；webapp.py 挂载点已存在（`langgraph.json` `http.app`）。
- state 里已有的 `tutor_audio/raw_audio/polished_audio` 是主链产物，不与弹窗混用，
  避免快照过期与格式耦合。

**Alternatives considered**:
- 弹窗音频由图节点预合成进 state：三口音×每轮都合成浪费且拖慢主链；放弃。
- 前端 Web Speech API 播放：音色与讯飞不一致，原型一致性差；放弃。

**前端音频播放基建**：项目当前无 `<audio>` 播放组件（全库仅 dictation 采集用 AudioContext），
需新建一个小型播放 hook（创建 objectURL + `new Audio()` + 播放态管理），属前端新增视图能力。

---

## R6. 三风格润色一次性生成（Clarifications Q1 决策 A 落地）

**Decision**: 扩展润色输出 schema 与提示词，图结构与节点逻辑零改动：

1. **`polisher_schema.py`**：新增 `StylePolish(BaseModel) = {polished_text, explanation}`；
   `PolishResult` 保留 `original_text/polished_text/explanation` 三字段语义不变
   （= **地道美式**，默认风格，向后兼容现有消费链 `public_tts_node`），追加两个可选字段：
   `style_business: StylePolish | None`（商务正式）、`style_british: StylePolish | None`（地道英式）。
2. **`SKILL.md`**：在 Section 6（Required Output Format）追加三风格输出要求
   （各风格独立改写与中文解释、风格定位、失败/无需修改时的处理），不改动既有规则段落。
3. **`get_polisher_model`**：system prompt 核心要求追加一条"按三风格输出"，模板变量仍只有
   `text`（调用方契约不变，partial 固化机制不动）。
4. **`polisher_service.polish_text`**：主链校验逻辑不变；对两个可选风格字段做"取到才校验"——
   复用既有三条确定性校验规则（长度比/英文占比/中文混入，抽成小函数逐风格复用），
   校验失败或字段缺失 → 该风格输出 `None`（前端按 Edge Cases 空态降级），不影响主风格。
5. **`state.PolisherOutput`**：追加 `style_business: dict | None`、`style_british: dict | None`
   两个可选字段；`polisher_node` 返回完整 dict 时带默认 `None`（续杯模式契约不变）。

**Rationale**:
- Q1 已裁决 A 方案；可选嵌套字段对 DeepSeek structured output 兼容性好于自由 dict 键。
- 保留原三字段 = 默认风格：`public_tts_node`、现有 `polished_audio` 链路零感知，回归风险最小。
- 单次调用生成三风格 vs 三次调用：成本/延迟占优，且 Q1 决策 A 明确"一次性生成"。

**Alternatives considered**:
- 三字段改 `styles: dict[str, StylePolish]`：LLM 对自由键名的 structured output 稳定性弱于
  固定可选字段；放弃。
- 三次按风格调用（每次固定一种）：延迟×3，与 Q1 决策不符；放弃。

---

## R7. 弹窗 UI 组件选型

**Decision**:
- 弹窗容器：Base UI Dialog + Portal（参照 `frontend/components/scene-select/scene-select-popup.tsx:34-52`
  与 `frontend/components/ui/dialog.tsx`），居中卡片式（原型图为全屏卡片流）。
- 三风格 Tab：无现成 Tabs 组件（`components/ui/` 仅 button/dialog/tooltip/skeleton/
  textarea/collapsible/avatar），用 button 行 + 选中下划线自绘（原型图样式简单，不值得引依赖）。
- 三条进度条：div + 宽度百分比 + 语义色；综合评分徽章：SVG 圆环；语速仪表盘：SVG 弧形
  （50→250 词/分刻度，Slow→Fast 渐变，指针角度 = 线性映射），均按原型图自绘轻量组件。
- 复制：`navigator.clipboard.writeText` + 成功态反馈（参照 thread.aui.tsx 的 Copy 图标切换模式）。
- 收藏：内存态标记（spec Assumptions 明确不做持久化），模块级 Set 即可。
- 循环跟读：`audio.loop = true` + 按钮激活态。
- 状态残留防护：弹窗关闭时停止播放、复位 Tab 到"地道美式"（FR-014）。

---

## R8. 气泡入口（发音/地道 按钮）

**Decision**: 在 `frontend/components/thread.aui.tsx` 的 `UserMessage`（`:579`）内、
气泡旁新增"发音"与"地道"两个入口按钮（原型图：按钮位于用户气泡下方左侧）。两个入口打开
同一个弹窗组件，差异仅在初始滚动锚点（发音 → 逐词分析区块；地道 → 语境润色区块）。

**Rationale**:
- `useAuiState((s) => s.message.metadata.modality === "voice")`（thread.aui.tsx:217 已有先例）
  可识别语音气泡；按钮渲染在语音 modality 的用户气泡上。
- 弹窗数据取线程级 state 快照（R1），语义上对齐"最新一轮朗读"；历史气泡点击同样打开弹窗，
  数据区块按 FR-015 空态降级（spec Assumptions 已覆盖）。
- 现有 `UserActionBar` 位于气泡左侧 hover 区，原型图按钮在气泡下方 → 新增独立行，不复用
  ActionBarPrimitive（避免 hover autohide 与原型不符）。

---

## 未决项汇总

| # | 事项 | 处理 |
|---|---|---|
| 1 | 讯飞英音发音人 vcn 具体值 | NEEDS EXTERNAL CONFIRMATION：实现期讯飞控制台试听确认；不可用则该控件置灰（FR-015） |
| 2 | ISE XML 是否有重读/连读原生字段 | NEEDS EXTERNAL CONFIRMATION：实现期用真实 `ise_xml_info` 样本核对；当前按 R2 二级推导 |
| 3 | `time_len` 属性在英文引擎 XML 的确切位置 | 实现期用真实样本核对；缺失时 `speed_wpm=None` 仪表盘空态 |
