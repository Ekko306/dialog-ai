"""New LangGraph Agent.

This module defines a custom graph.

注意：这里不做任何导入。langgraph.json 按文件路径直接加载 talk_graph.py:graph；
包级导入会在加载子模块时触发本 __init__，形成循环/重复执行，且 `backend.` 前缀
依赖项目根目录在 sys.path（langgraph dev 的工作目录是 backend，必然失败）。
"""
