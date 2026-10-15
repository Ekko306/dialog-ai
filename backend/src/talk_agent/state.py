
from typing import Annotated, TypedDict

from operator import add
from langgraph.graph import MessagesState, StateGraph, START, END


class OverAllState(MessagesState, total=False):
    """整个口语训练系统使用的全局状态。"""

    # 文本类状态
    raw_text: str  # 未清洗的文本

    # 英语表达润色状态
    original_text: str  # 润色前的原文
    polished_text: str  # 润色后的英文
    explanation: str  # 中文润色说明
    polish_comment: str  # 兼容项目原有模块的润色说明字段

    # 走分支类状态（#todo，后续可考虑改成 Command）
    user_input: str
    has_issue: bool

    # 日志类
    talk_ids: Annotated[list[str], add]  # 对话 ID，某次图执行
    cur_talk_id: str  # 当前对话 ID

    # LastValue：值由子图输出整体接管（子图内部用 add 累积后整表输出）。
    # 注意：父图层面不要直接写 logger，LastValue 语义下会覆盖而非追加。
    logger: list[str]


class SubgraphState(MessagesState, total=False):
    """子图 schema：logger 挂 add reducer，在子图内部累积。

    机制：子图作为节点挂载时，父图把共享 key 的当前值喂给子图，
    子图按自己的 reducer 跑完后，把最终 channel 值整体输出，
    父图再用父图的 reducer 合并。

    因此两边各持一种语义，避免子图和父图重复追加日志：
    - 子图 logger 带 add：输入日志 + 本次新增日志 → 输出累积列表
    - 父图 logger 使用 LastValue：直接接管子图输出的累积列表
    """

    # 文本类状态
    raw_text: str  # 未清洗的文本

    # 英语表达润色状态
    original_text: str  # 润色前的原文
    polished_text: str  # 润色后的英文
    explanation: str  # 中文润色说明
    polish_comment: str  # 兼容项目原有模块的润色说明字段

    # 逻辑类
    has_issue: bool

    # 日志类（add：累积之前的日志 + 本次新增，输出完整列表）
    logger: Annotated[list[str], add]
