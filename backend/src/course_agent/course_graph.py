"""课程图入口（供 langgraph.json 注册：`./src/course_agent/course_graph.py:graph`）.

真实实现见 `lesson_graph.py`；这里只做重导出，保持注册路径不变。
"""

from src.course_agent.lesson_graph import build_lesson_graph

# 平台自带持久化，注册给 LangGraph API/Studio 的图不挂自定义 checkpointer
graph = build_lesson_graph(with_checkpointer=False)

__all__ = ["graph", "build_lesson_graph"]
