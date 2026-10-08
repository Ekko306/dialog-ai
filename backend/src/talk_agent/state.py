from typing import Annotated, TypedDict

from operator import add


class OverAllState(TypedDict, total=False):
    raw_text: str  # 未清洗的文本

    # 逻辑类
    has_issue: bool

    # 日志类
    talk_ids: Annotated[list[str], add]  # 对话id，某次图执行
    cur_talk_id: str  # 当前对话id
    # LastValue：值由子图输出整体接管（子图内部用 add 累积后整表输出）。
    # 注意：父图层面不要直接写 logger，LastValue 语义下会覆盖而非追加。
    logger: list[str]


class SubgraphState(TypedDict, total=False):
    """子图 schema：logger 挂 add reducer，在子图内部累积。

    机制：子图作为节点挂载时，父图把共享 key 的当前值喂给子图，
    子图按自己的 reducer 跑完后，把最终 channel 值整体输出，
    父图再用父图的 reducer 合并。

    因此两边必须各持一种语义，避免"子图加一次、父图再加一次"的重复：
    - 子图 logger 带 add：输入(之前累积的日志) + 本次新增 → 输出完整累积列表
    - 父图 logger 用 LastValue：直接接管子图输出的累积列表
    """

    raw_text: str  # 未清洗的文本

    # 逻辑类
    has_issue: bool

    # 日志类（add：累积之前的日志 + 本次新增，输出完整列表）
    logger: Annotated[list[str], add]
