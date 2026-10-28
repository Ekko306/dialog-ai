# Contract: 纠错消息数据契约（correction-message-contract）

**方向**: backend `tutor_reply_message_node` → 前端 AI 消息渲染分支
**性质**: 本 feature 唯一的后端改动（Constitution 原则 II 最小适配，理由见 plan.md）

## 后端侧（透出）

`backend/src/talk_agent/talk_graph.py → tutor_reply_message_node`：构造 AIMessage 时，透传数据必须写在 **`additional_kwargs["metadata"]`** 键下（implement 实施修正：前端 @assistant-ui/react-langchain `convertMessages.ts` 的 `getCustomMetadata` 只把 `additional_kwargs.metadata` 映射为 assistant-ui 消息的 `metadata.custom`，写其他顶层键前端读不到）：

```python
# 实施代码（不改节点逻辑，只加透传；已通过 §0 API 级验证）
msg = AIMessage(content=tutor_reply_text)
msg.additional_kwargs["metadata"] = {
    "correction_data": {
        "raw_text": raw_text,            # str，用户原句
        "tutor_reply": tutor_reply_text, # str，讲解全文
        "corrections": [                 # list[{wrong, correct, type}]，可为 []
            {"wrong": "...", "correct": "...", "type": "..."}
        ],
        "ise_grade": ise_grade,          # float | None
        "feedback": None,                # str | None（预留字段，本期无 UI 消费，analyze F2）
    }
}
```

- 仅当进入 tutor 主链（非 TTS 旁路）时携带；字段缺失时允许省略键
- 不改动 graph 拓扑、其他节点、LLM 调用与 state 定义

## 前端侧（读取）

- 经 `useStreamRuntime` 流式映射后，`additional_kwargs.metadata` 映射为 assistant-ui 消息的 `metadata.custom`（已核实包源码 convertMessages.ts L136）
- **流式链路限制（2026-10-26 浏览器验收发现，已实测证实）**：`@langchain/langgraph-sdk` v2 messages 通道组装消息时会把消息重建为 content blocks（`assembledToBaseMessage`），`additional_kwargs` 仅保留 `usage`——服务端透传的 `metadata.correction_data` 在流式路径被静默丢弃；且 values 回声消息（含完整 kwargs）因 content 表示不一致（字符串 vs blocks 数组）无法在消息协调中胜出（`shouldPreferValuesMessage` 的 `jsonishEqual(content)` 前置条件恒假）
- 因此前端实际读取为**双路径**（correction-bubble.tsx `CorrectionAwareAssistantMessage`）：
  1. `message.metadata.custom.correction_data`（契约原路径，非流式/历史回灌场景生效，保留兼容）
  2. **LangGraph 顶层 state 字段关联（流式主路径）**：`useLangChainState` 读 `tutor_reply`/`raw_text`/`corrections`/`ise_grade`/`feedback` 五个全局 state 字段（values 事件原样保留），用「消息正文 === tutor_reply」做消息级关联（两者后端同源，天然防串轮），并按 message id 写入会话级缓存使历史气泡在本会话内持续展示
- 识别规则：任一路径取到数据 → 纠错气泡；否则普通气泡
- **字段容错**：任一字段缺失/类型不符 → 按缺省渲染（corrections 空 → 无 ✅ 行；ise_grade null → 发音项不展示），不抛错

## Fallback（联调验证失败时启用）

**已转正为主路径**：原留档方案「useLangChainState 匹配」因上述流式链路限制成为实际主读取方式（见前端侧路径 2）；§0 API 级验证仍有效（透传数据在 SSE values 事件与线程终态中完整），后端无需改动。

## 验收对照

- spec FR-001/FR-002（识别与双态渲染）、Edge Cases（普通消息零回归、字段缺失容错）
- quickstart.md §0（契约透传验证）为 implement 第一验收步
