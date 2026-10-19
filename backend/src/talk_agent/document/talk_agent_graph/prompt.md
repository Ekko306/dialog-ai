# AI生成设计文档，提示词流程

## 告知总体目的
我现在要设计langgraph的智能体来实现我的功能，
我要你要干的事情是：
1. 理解langgraph的语法基础，知道如何设计出专业和效率很高的智能体流程
2. 了解drawio在vscode中如何绘制图，知道如何生成test.drawio的流程图
3. 理解我告诉你的具体的agent需要的逻辑，聚焦于某个特定的业务场景
2. 能够生成agent.drawio文件画一个langgraph的智能体调用流程图，设计流程要符合官网规范，并能够基于这个流程图，让我很方便的编写langgraph的python代码

请先理解我要你做的总体事情，等下我会分步骤，让你完成这件事情，只有全部前提知识介绍完毕，才开始动手生成文件


## 告知langgraph语法基础
注意要准确使用langrgaph的技巧：
1. 用graph API，注意
2. 要使用如下的langgraph技巧，特别是提示词要准确

01 Langgraph基础入门

1. LangGraph总览
o1.0 Langgraph和LangGraph的版本迭代及定位
o1.1 构成图的基本要素
o1.2 图运行过程
o1.3 Graph API vs Functional API
2. 图的基础构建与运行
o2.1 定义状态图
o2.2 编译状态图
o2.3 调用状态图
o2.4 完整代码
o2.5 图结构可视化
3. 图的状态（State）管理
o3.1 状态定义
o3.2 State Reducer
o3.3 节点中访问State
o3.4 Multi Schema用法
o3.5 预定义状态

02 控制流与节点执行
 4. 控制流
  4.1 顺序结构
  4.2 分支结构
  4.3 多分支汇聚： Fan-in
  4.4 循环结构
  4.5 Edges总结： LangGraph中的边
 5. 节点执行与容错机制
  5.1 LangGraph的节点容错机制
  5.2 重试机制★
  5.3 超时控制
  5.4 错误处理
  5.5 节点缓存★
  5.6 全图默认配置
  5.7 小结

03 持久化与记忆管理
 6. 持久化机制和可恢复执行
  6.1 概述
  6.2 启用可恢复执行
  6.3 持久化模式
  6.4 查看历史检查点
  6.5 使用场景
 7. 图记忆管理
  7.1 短期记忆
  7.2 长期记忆
  7.3 运行时上下文
  7.4 Node总结：Langgraph的节点
 附录A. PostgreSQL的部署与配置
  A.1 PostgreSQl简介
  A.2 PostgreSQL的安装与部署
  A.3 PostgreSQL基本操作

04 中断与工具与部署
 8. 中断
  8.1 动态中断
  8.2 静态断点
 9. 项目部署
  9.1 本地部署并对接LangSmith
  9.2 本地部署并对接AgentChatUI
 10. 工具调节点
  10.1 工具节点的实现
  10.2 进阶用法

05 高级特性
 11. 流式执行
  11.1 概述
  11.2 stream/astream
  11.3 astream_events
 12. 子图
  12.1 两种子图嵌入方式
  12.2 子图持久化
  12.3 子图流式执行
  12.4 子图动态路由
 13. 运行图设计模式
  13.1 概述
  13.2 实现
   13.2.1. Prompt Chaining：提示词链
   13.2.2. Parallelization：并行化
   13.2.3. Routing：路由
   13.2.4. Orchestrator-worker：编排器—工作节点
   13.2.5. Evaluator-optimizer：评估器—优化器
   13.2.6. Agent：智能体循环

同时请自己学习langgraph的画图规范（例如，实线表示静态流程，虚线表示动态流程）

## 告知drawio
查看documents/test.drawio文件，知道如何在vscode中使用drawio插件流程，请知晓如何生成*.drawio文件

## 告诉某个智能体的具体思路
我现在要实现一个语法交互的智能体AI
需求详情：我和智能体对话输入一段语音，智能体判断我的语音进行指导
第一步，判断我上一个句子，语法有没有问题，如果语法有问题则指出我的语法问题（用AI Agent限制，需要提示词），如果没有语法问题，则推荐走拓展润色（用AI Agent限制，需要提示词），
第二步，回复我的说的句子，继续进行对话，评论我上个句子怎么样，并给出两句提示词，能够辅导我根据提示词开启下一个语言内容对话（用AI Agent限制，需要提示词）

请思考这个需求，有基本想法

## 开始生成drawio图
前提知识介绍完毕，帮助生成一个talkAgent.drawio文件， 设计上并画出面的langgraph流程图，不要生成太抽象的流程图， 我需要能够具体实现的，要求使用短期记忆、中断，控制流，图设计模式等方式去管控一个小白的大模型的流程，帮我在talkAgent.drawio流程图上再次修改，

<!-- ## 图修改（第二次再执行）
具体再生成4个drawio文件，分别具体实现grammar_check · LLM 评估节点

grammar_tutor · LLM 节点

polisher · LLM 节点

coach_reply · LLM 节点 注意使用好langgraph的能力来调控底层后端llm

Agent -->

<!-- # 不同llm测试
- GLM-5.3-Flash  token消耗  实现效果 -->