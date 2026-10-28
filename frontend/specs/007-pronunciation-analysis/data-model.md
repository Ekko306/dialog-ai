# Data Model: 发音逐词分析面板

**Feature**: 007-pronunciation-analysis | **Created**: 2026-10-27

## 前端实体

### EvaluationResult（评测结果，端点响应镜像）

```ts
interface EvaluationWord {
  word: string;          // 原句分词（XML word/@content）
  score: number | null;  // 百分制逐词分；无逐词分为 null（不着色不编造）
  flags: string[];       // 异常标记（"漏读"/"增读"/"回读"/"替换"/"音素异常"）
}

interface EvaluationResult {
  total: number | null;      // 综合评分（百分制）
  accuracy: number | null;   // 发音分
  fluency: number | null;    // 流利度
  integrity: number | null;  // 完整度
  is_rejected: boolean;      // 读的内容与参考句不符 → 分数无效
  words: EvaluationWord[];
}
```

- 来源：`POST /audio/evaluate` 响应（后端 parse_ise_xml 输出原样 JSON 化，字段名一致）
- 无效语义：`is_rejected=true` 或关键字段全 null → 视为失败（失败重试态，不渲染误导数字）

### 会话内缓存（模块级 Map，刷新即清）

| 缓存 | 键 | 值 | 写入时机 | 消费方 |
|---|---|---|---|---|
| `recordingStore` | 转写文本（= 发送的 raw_text） | Int16 PCM ArrayBuffer | dictation stop 成功后 | 面板打开时按 raw_text 查，取 PCM 发评测 |
| `evaluationCache` | messageId | EvaluationResult | 首评/重读成功后 | 面板打开命中零请求；重读覆盖写（仅面板消费，不回写气泡） |

### PronunciationSectionState（发音区状态机）

```
no_recording  → 会话内找不到本轮录音（文本输入/刷新后/文本被改写）→ 降级文案，重读入口隐藏
idle          → 有录音未评测（理论瞬态，打开即评）
loading       → 评测请求进行中（骨架/加载文案）
ready         → 有 EvaluationResult → 渲染逐词 + 四项分
failed        → 请求失败 / is_rejected / 无效结果 → 行内重试
rerecording   → 重读录音操作区展开（覆盖 idle/loading 视图，取消回到先前状态）
```

## 后端端点契约要点（详见 contracts/evaluate-endpoint-contract.md）

- 输入：octet-stream PCM（16kHz/16bit/单声道/小端）+ `ref_text` query 参数
- 输出：EvaluationResult 同形 JSON；错误形态 `{detail}`（400 过短 / 415 类型 / 500 评测失败 / 422 缺 ref_text）
- 复用函数：`xfyun_ise_tool_by_audio_data(audio, ref_text)` + `parse_ise_xml(xml, max_score=5.0)`

## 与既有结构的关系（复用清单）

| 既有结构 | 用途 | 改动 |
|---|---|---|
| server-dictation-adapter 采集段 | 抽为 `lib/pcm-recorder.ts` 公共工具 | adapter 内部改用（行为不变）+ 重读录音使用 |
| 003 raw kind TTS 缓存键 `${messageId}:raw` | 面板「美音」示范播原句 | 零改动（useTtsButton 同键命中） |
| 006 IdiomPanel / polisher-bypass-client | 语境润色区块原样复用 | IdiomPanel 扩展两区块（mode=correction 时） |
| correction_data.raw_text / corrections[0].correct | 面板输入（原句/纠正句） | 零改动（003 契约既有字段） |
| ScoreBar（003） | 气泡评分条 | 「发音」入口行为从占位提示改为开面板；评分条数据零改动 |

## 组件数据流

```
dictation stop ──→ recordingStore.set(transcript, PCM)
                                          │
纠错气泡 ─ 点「发音」/「地道」─→ IdiomPanel(mode="correction")
                                      │
                    打开时：evaluationCache 命中？──是──→ ready
                                      │否
                    recordingStore.get(raw_text) ──无──→ no_recording 降级
                                      │有
                    POST /audio/evaluate(PCM, ref=raw_text)
                          │成功                  │失败/rejected
                         ready（写缓存）        failed（重试→重发）
「↻ 重读」→ pcm-recorder 新录音 → POST /audio/evaluate(PCM, ref=raw_text) → 覆盖 evaluationCache → ready
```
