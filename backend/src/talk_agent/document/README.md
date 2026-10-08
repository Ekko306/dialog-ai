# 自由对话智能体



talk_agent_graph
1. grammar_check_graph 语法检查
    1. grammer_tutor_graph 语法纠错
    2. polisher_graph 语法润色
2. coach_reply_graph 教练提供恢复


## talk_agent_graph
1. 全局短期记忆， 支持上下文恢复/ 错误恢复
2. 长期记忆，自由对话使用的角色，后续所有节点根据这个前提，注册进入llm对话， （store）（全局set_nodes方法？）
3. 工具：语音转文字，提供后续子图执行逻辑（state，提供后续节点处理）
4. 上下文管理（各个节点之间连接，传递消息，上下文情况）
5. 子图调用方式：子图直接作为父图的节点，父子图共享状态字段（小项目应该没事）

## grammer_check_graph


1. 工具：语音辨析（结果state，提供润色或） 
2. 拿text和辨析结果， 大模型走判断结构化输出(with_structed)，输出结果， 提供router，同时提供判断理解
    - 理解便于下一个阶段（纠错或润色）

## grammar_tutor_graph, polisher_graph
单独训练自己的prompt，单独封装skills，接受输入，得到输出，不存在记忆

# coach_reply_graph
任务：
1. 根据角色回答
2. 根据上次聊天话题回答
3. 给出建议回复消息


## 优化：
1. skill？
2. 图设计模式优化，效果与速度，token消耗
3. 记忆与边界
