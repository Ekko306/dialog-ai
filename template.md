```
- langgraph new backend --template new-langgraph-project-python

可选  
- deep-agent-python  1111
- deep-agent-js
- agent-python  1111
- new-langgraph-project-python  dddd
- new-langgraph-project-js
```

这三个模板都是 LangGraph 官方脚手架，但抽象层级和适用场景完全不同。结合你三个 README 的内容，对比如下：

## 三个模板的区别

| 维度 | ① `new-langgraph-project-python` | ② `agent-python` | ③ `deep-agent-python` |
|---|---|---|---|
| **定位** | 最小化入门模板 | 标准 Agent 部署模板 | 深度智能体模板 |
| **核心 API** | 手写 `StateGraph`（单节点固定回复） | `create_agent(...)` | `create_deep_agent(...)` |
| **复杂度** | ⭐ 一个节点，返回固定字符串 | ⭐⭐ ReAct 式循环 Agent + 简单工具 | ⭐⭐⭐ 规划、子代理、文件系统、人工介入 |
| **内置能力** | 无（纯骨架） | 工具调用（如模板中的 `utc_now`、`calculator`） | 子代理（`researcher`、`critic`）、planning、`execute`/`write_file` 上的 human-in-the-loop 中断 |
| **依赖模型** | 不依赖 API key | 需要 `ANTHROPIC_API_KEY` | 需要 API key + LangSmith Plus 部署 |
| **适合学习** | LangGraph 状态机、图结构、Studio 调试 | LangChain Agent 基础用法 | 多智能体编排、任务分解 |

## 各自的核心代码结构

**① 最小模板** —— 一个 node，跑一遍就结束，适合理解 `StateGraph` + `Context` 的机制：

```python
# src/agent/graph.py（概念示意）
builder = StateGraph(State, context_schema=Context)
builder.add_node("node", call_model)   # 返回固定字符串
builder.add_edge(START, "node")
builder.add_edge("node", END)
```

**② Agent 模板** —— `create_agent` 一行构建带工具循环的 Agent：

```python
agent = create_agent(model, tools=[utc_now, calculator], system_prompt=...)
```

**③ Deep Agent 模板** —— 你当前 `my-large-agent` 用的就是这个，内置了子代理委派和中断审核：

```python
agent = create_deep_agent(
    model,
    subagents=[researcher, critic],          # 子智能体
    interrupt_on=[execute, write_file],      # 敏感操作前人工确认
)
```

## 我建议你用哪个？

**继续用你现有的 ③ `deep-agent-python`（即 `d:\projects\syp\Develop\DialogAi\my-large-agent`）**，理由：

1. **你的项目定位就是大型 Agent**（"my-large-agent"），且 [AGENTS.md](file:///d:/projects/syp/Develop/DialogAi/my-large-agent/AGENTS.md) 中的约定（async 优先、子代理在 `src/deep_agent/graph.py`、避免真实文件系统调用）都是围绕 deep agent 写的，换模板要推翻这些约定。
2. 复杂的多步任务（规划 → 委派 → 批判 → 汇总）正是 deep agent 的设计目标；用模板 ② 你得自己搭子代理编排。
3. 模板 ③ 自带 human-in-the-loop，部署到服务端时对危险操作有安全兜底。

**什么时候用另外两个：**

- 如果只是想**学习 LangGraph 的图机制**、跑通 Studio 调试 → 用模板 ①（你的 `temp/temp/my-large-agent`），它没有外部依赖，最适合读源码理解 `StateGraph`/`Context`（你正在学的 context dataclass 用法在它的 `graph.py` 里有标准示例）。
- 如果任务简单（单轮工具调用就能解决）、想快速部署一个轻量 Agent → 用模板 ②（`temp/my-large-agent`）。

**清理建议**：`temp/` 下的两个副本如果只是用来对比，确认后可以删掉，避免三个同名项目混淆。