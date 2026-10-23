# DialogAi 前端 Constitution

## Core Principles

### I. assistant-ui 框架规范优先

前端项目（`frontend/`）由 `npx create-assistant-ui@latest -t langchain` 脚手架生成，所有 UI 开发
MUST 遵循 assistant-ui 官方开发规范（https://www.assistant-ui.com/）：

- 优先使用 assistant-ui 提供的组件、Hooks 与运行时数据流原语，不重复实现框架已有能力
- 新增 UI 功能前 SHOULD 查询 assistant-ui MCP（`mcp_assistant-ui`）确认官方推荐的组件与用法，
  文档查询优先于凭记忆猜测 API
- 自定义或扩展组件时 MUST 保持与脚手架生成代码一致的风格与目录约定

理由：遵循框架规范可保持与上游模板兼容、降低升级与维护成本，并最大化利用官方已有能力。

### II. 前端适配后端，后端逻辑最小改动

后端（`backend/`）是 LangGraph 开发的 AI Agent 服务，是接口契约的事实来源（source of truth）：

- 前端 MUST 依据后端现有接口与数据结构做适配展示，优先调整前端而非后端
- 确需修改后端时，改动 MUST 限于联调必需的最小范围（如字段透出、响应格式适配），
  MUST NOT 重构或改变 Agent 核心业务逻辑（graph 结构、节点逻辑、状态定义）
- 涉及后端开发时 SHOULD 参照 backend 既有代码规范做适当适配；必要时查询 LangGraph MCP
  （`mcp_docs-langchain`）确认框架用法
- 若后端原始写法不符合联调规范，经确认后可对后端做最小修改，修改理由 MUST 记录在对应
  功能的 plan.md 中

理由：后端逻辑已验证且需保持稳定；前端作为可视化层，前端适配的成本低于反向改动后端。

### III. 现有数据结构复用，读取展示优先

前端的核心目标是依据后端接口可视化展示 AI Agent 后端中的数据：

- 新功能 MUST 优先复用现有调用框架与既有数据结构，MUST NOT 为单个 UI 需求引入
  大规模数据结构变更
- 开发内容以"读取 + 展示"为主：转换、派生、格式化逻辑 SHOULD 尽量在前端视图层完成
- 基于已联调通过的基础流程增量扩展 UI 流程（原型图要求见原则 IV）

理由：基础调用流程已调通，保持数据结构稳定可避免回归风险，让开发聚焦于 UI 价值交付。

### IV. 原型图驱动开发

原型图目录固定为 `frontend/docs/mockups/`，每张原型图对应一个功能（或子功能），
功能启动时由用户指定本次功能对应的原型图：

- 自 `/speckit-specify` 起，功能工作流的每一步（clarify、plan、checklist、tasks、
  analyze、implement ⇄ converge）MUST 依据对应的原型图展开
- spec.md、plan.md、tasks.md 中 MUST 显式引用原型图路径，作为需求与验收的对照基准
- implement 完成后的界面效果 MUST 与对应原型图进行目视比对，不一致处以原型图为准
  （除非用户明确调整需求）

理由：原型图是需求的最终视觉事实来源；每一步都对照原型图可避免理解偏差在流程中
层层放大，降低返工成本。

## 技术栈与工具约束

- 前端：以 assistant-ui 脚手架（langchain 模板）生成的技术栈为准，未经确认 MUST NOT
  擅自替换核心依赖或运行时方案
- 后端：LangGraph；`backend` 代码仅做联调所需的最小适配
- MCP 工具：assistant-ui MCP（`mcp_assistant-ui`）用于前端框架规范与组件用法查询；
  LangGraph MCP（`mcp_docs-langchain`）用于后端框架用法查询

## 开发工作流

- 采用 Spec Kit 工作流：每个功能从 `/speckit-specify` 开始，依次经历 clarify → plan →
  checklist → tasks → analyze → implement ⇄ converge，直到报告 Converged
- 需求输入：原型图目录固定为 `frontend/docs/mockups/`，每张图对应一个功能（或子功能）；
  自 `/speckit-specify` 起的每一步 MUST 依据对应原型图展开（见原则 IV）
- 联调原则：前端适配为主；确需改动后端时遵循原则 II 的最小改动约束并留档

## Governance

- 本 Constitution 优先于其他一切开发实践；与个人习惯或外部示例冲突时以本文档为准
- 修订 MUST 更新本文档并遵循语义化版本：MAJOR = 原则删除或重定义；MINOR = 新增原则
  或实质性扩展；PATCH = 文字澄清与非语义修订
- 所有功能的 spec / plan / tasks 评审 MUST 检查与本文档的合规性，不合规项 MUST 修复后
  才能进入实现
- 运行时开发指引放在各功能的 plan.md 与 agent 上下文中，不在本文档重复

**Version**: 1.1.0 | **Ratified**: 2026-10-21 | **Last Amended**: 2026-10-21
