# Contract: 润色反馈消息透传契约（005-polisher-bubble）

**Date**: 2026-10-27 | **关系**: 与 003 correction_data 透传契约完全同构；与 003 TTS 旁路契约、004 翻译旁路契约互不干扰

## 1. 后端透传（唯一后端改动）

**节点**: `talk_graph.py :: polisher_reply_message_node`（润色分支轮次收尾，父图 `polisher_subgraph → polisher_reply_message_node → END`）

**挂载位置**: 该节点产出的 AIMessage 上

```python
msg = AIMessage(content="\n".join(parts))          # 正文不变
msg.additional_kwargs["metadata"] = {
    "polisher_data": {                              # 与 003 "correction_data" 平级的独立键
        "raw_text": original_text,                  # state.polisher.original_text
        "polished_text": polished_text,             # state.polisher.polished_text
        "explanation": explanation,                 # state.polisher.explanation
        "polish_status": polisher.get("polish_status", ""),  # success | fallback | skipped
    }
}
```

**键名硬约束**（003 实测教训，不可偏离）：必须写在 `additional_kwargs["metadata"]` 下——`@assistant-ui/react-langchain` 的 convertMessages 仅将该键映射为前端消息的 `metadata.custom`，写其他顶层键前端读不到。

**正文文案不变**：`当前语句没有错误，没有tutor_reply。` + 可选 `润色建议：{polished_text}` + 可选 explanation（research R6：文案超出本 feature 边界）。

**挂载条件**: 无条件挂载（含 fallback/skipped）——降级判断由前端守卫执行（FR-009），后端不掺渲染决策。

## 2. 前端读取双路径

| 路径 | 场景 | 读取方式 |
|---|---|---|
| A. metadata 直读 | 非流式 / 历史回灌 | `message.metadata.custom.polisher_data` |
| B. state 同源关联 | 流式主路径（A 失效时） | `useLangChainState("polisher", null)` → 取 `polisher` 字典四字段；消息级关联：`messageText.includes(polished_text.trim())` 且 polished_text 非空 |

**消息级缓存**: `polisherCache: Map<messageId, PolisherMessageData>`——命中后历史气泡持续展示；刷新自然失效。同一消息先入纠错缓存则不再进润色路径（分流优先级，R3）。

## 3. 渲染守卫（前端，FR-009）

命中数据后仍须满足**全部**条件才渲染润色气泡，否则普通消息：

1. `polished_text.trim() !== ""`
2. `polished_text.trim() !== raw_text.trim()`（fallback 保留原文场景）
3. `polish_status !== "skipped"`（无英文内容场景）

## 4. 与既有旁路契约的关系

| 旁路 | 触发 | 目标 assistant_id | 本 feature 使用 |
|---|---|---|---|
| 003 TTS（tts_request） | 功能行/操作栏 AI 发音、跟读示范音频 | `grammer_tutor` | ✅ 复用；corrections 传润色伪条目 `{wrong, correct: polished_text, type: "polish"}`，raw kind 取 raw_text，correct kind 取 polished_text |
| 004 翻译（translate_request） | 功能行「文A」 | `grammer_tutor` | ✅ 原样复用，翻译对象为 raw_text |
| 本契约（消息透传） | 润色分支轮次自动 | 无（随消息流） | 新增；无独立请求端点 |

**父图 HITL 坑位**（003 教训沿用）：旁路请求必须直调子图注册键，发父图 `talk_agent` 会挂在 HITL 永远到不了目标节点。

## 5. 失败语义

| 场景 | 表现 |
|---|---|
| metadata 与 state 均未命中（历史消息刷新后） | 普通消息渲染，不报错 |
| polish_status = fallback / skipped / polished == raw | 普通消息渲染（FR-009） |
| 旁路发音失败 | 「语音合成失败，请稍后重试」轻提示（003 FR-012 既有行为） |
| 翻译失败 | 004 四态状态机既有行为（可重试） |
