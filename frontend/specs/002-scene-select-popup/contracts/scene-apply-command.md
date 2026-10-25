# Contract: 场景应用指令（scene-apply-command）

**Branch**: `002-scene-select-popup` | **Spec**: [spec.md](./spec.md) | **原型图**: `frontend/docs/mockups/子功能-语音工具-选场景弹出弹窗.png`

前端 ⇄ 后端之间"弹窗选场景立即生效"的唯一契约。传输通道复用既有 LangGraph interrupt resume 路径（`useLangChainRespond`），不新增 HTTP 端点。

## 1. 指令格式

```text
_set_context_::<role>::<scenario>
```

- 前缀：字面量 `_set_context_`（与既有 `_new_context_` / `_test_coach_` 同族的内部指令，双下划线包裹）。
- 分隔符：`::`（中文字符安全；前端目录数据保证 `role`/`scenario` 不含 `::`）。
- `<role>` / `<scenario>`：非空 UTF-8 字符串，来自前端静态目录条目的 `role` / `scenario` 字段（见 [scene-catalog.md](./scene-catalog.md)）。
- 示例：`_set_context_::英语口语教练::求职面试`

## 2. 发送方契约（前端 `scene-applier.tsx`）

**触发时机**：`pendingScene ≠ null` 且 `useLangChainInterruptState()` 非 null（图停在任意 HITL 中断）。

**调用**：`respond("_set_context_::" + role + "::" + scenario)`。

**成功**：promise resolve → 清除 `pendingScene`。此后端已把场景写入 Store，下一条教练回复按新场景生成（立即生效）。

**失败**：promise reject（网络/服务异常）→ 清除 `pendingScene`（保留当前已生效场景，不中断对话）+ 设置 `applyError` 提示（可感知失败，FR-013）。

**禁令**：
- MUST NOT 把指令作为普通用户消息发送（会被写入对话流污染 messages）。
- MUST NOT 在图运行中（`interrupt == null`）调用 respond——等待下一个 interrupt 出现后由 effect 自动补发。
- 冷启动（尚无对话）时指令暂存 `pendingScene`，待首个 interrupt 出现自动补发（已知边界：首轮话题为默认场景，第二轮起生效，见 research.md R1）。

## 3. 接收方契约（后端 `talk_graph.py`）

### 3.1 HITL_node（既有节点，1 处条件扩展）

指令串命中内部指令集合（`_new_context_` / `_test_coach_` / `_set_context_`）时，**只写 `user_input`，不写 `messages`**（指令不出现在对话流中）。resume 值原样落入 `user_input`。

### 3.2 HITL_route（既有函数，新增分支）

```text
"_set_context_" in user_input  →  "set_context"   （优先判定）
"_new_context_"  in user_input →  "new_context"   （既有，保持）
"_test_coach_"   in user_input →  "__end__"       （既有，保持）
其他                            →  "audio_check"   （既有，保持）
```

### 3.3 set_context_node（新增叶子节点）

输入：`state["user_input"]`、`runtime.store`。

行为：
1. 按 `::` 切分取第 2、3 段为 `role` / `scenario`；段缺失或空白时回退 `DEFAULT_ROLE` / `DEFAULT_SCENARIO`（防御路径，不抛错）。
2. 调用既有 `save_context(runtime.store, role, scenario)` 落 Store。
3. 返回 `{"role": role, "scenario": scenario, "logger": [...追加一条切换日志...]}`。

输出边：`set_context_node → END`。本节点不产生任何 messages、不调用 LLM。

## 4. 生效语义（验收判据）

| 场景 | 行为 |
|------|------|
| 对话停在 interrupt 时选场景 | respond → set_context → END → AutoContinue 自动续跑 → **下一条教练回复即新场景** |
| 对话运行中选场景 | 指令暂存，本轮跑完停到 interrupt 后自动补发 → 同上 |
| 选场景后新建对话（`_new_context_` 轮换或首次 `submit({})`） | Store 值继续生效（跨新对话保留，FR-014） |
| 选场景后刷新页面 | Store 在后端，场景继续生效；前端选择状态清零（下次打开弹窗回到默认态，clarify 决策③） |
| 选场景后使用 `_new_context_` 轮换 | 按既有轮换执行并以轮换结果覆盖 Store（两者并存，后写者生效，clarify 决策①/⑥验收项） |

## 5. 不变量（回归红线）

- 既有三条指令 `_new_context_` / `_test_coach_` / 普通文本应答的行为**逐字节不变**。
- `resolve_context` / `save_context` / `CONTEXT_SEQUENCE` / coach 子图零改动。
- 指令串绝不进入 `messages`（对话流无 `_set_context_` 字样）。
