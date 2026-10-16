
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
    polished_audio: bytes  # polisher 输出：润色后文本的美式发音 MP3

    # 语音链路（IAT/ISE）
    iat_status: str  # ok / no_speech / unavailable
    audio_data: bytes  # 麦克风录音 PCM
    audio_file_path: str  # ISE 音频文件路径
    ref_text: str  # ISE 标准参考句
    ise_lang: str  # 评测语言 cn/en
    ise_status: str  # ok / no_audio / no_ref / unavailable
    ise_xml_info: str  # ISE 原始评测 XML
    ise_grade: float | None  # 评测总分
    ise_check_results: dict  # ise_analyze_node 输出

    # 逻辑类
    user_input: str  # 走分支类状态
    has_issue: bool

    # grammar_check 子图输出契约（issues 用宽松 list 兼容 dict 和 str 两种元素）
    issues: list  # 语法错误列表（兼容两种元素类型）
    feedback: str  # 错误简短概述
    grammar_check_status: str  # ok / empty_input / invalid_input / unavailable

    # 语法辅导（grammar_check → grammer_tutor 的契约字段）
    tutor_reply: str  # grammer_tutor 输出的纠错讲解
    check_results: dict  # 上游 LLM 解析 XML 后的结构化清单
    corrections: list  # grammer_tutor 输出：修正句/示范词结构化结果
    tutor_audio: bytes  # grammer_tutor 输出：正确句的美式发音 MP3
    raw_audio: bytes  # grammer_tutor 输出：用户原句的美式发音 MP3


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
    polished_audio: bytes  # polisher 输出：润色后文本的美式发音 MP3

    # 逻辑类
    has_issue: bool

    # 语法辅导（grammar_check → grammer_tutor → coach_reply 的契约字段）
    issues: list[str]  # 上游 grammar_check 输出的错误列表
    tutor_reply: str  # grammer_tutor 输出的纠错讲解
    check_results: dict  # 上游 LLM 解析 XML 后的结构化清单（语法错误 + 发音问题）
    corrections: list  # grammer_tutor 输出：修正句/示范词结构化结果（供前端高亮 + TTS 朗读）
    tutor_audio: bytes  # grammer_tutor 输出：正确句的美式发音 MP3（供前端播放示范跟读）
    raw_audio: bytes  # grammer_tutor 输出：用户原句的美式发音 MP3（供前端对照播放原句）

    # 日志类（add：累积之前的日志 + 本次新增，输出完整列表）
    logger: Annotated[list[str], add]
