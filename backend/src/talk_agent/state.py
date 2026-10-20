
from typing import Annotated, TypedDict

from langchain_core.messages import AnyMessage
from langgraph.graph.message import add_messages
from operator import add


class PolisherOutput(TypedDict, total=False):
    """英语表达润色子图的输出结果（单节点一次性全部写入）。

    注意：LangGraph state 更新是字段级整体替换而非深合并，
    所以 polisher_node 每次必须返回包含全部 7 个字段的完整字典。
    """

    original_text: str          # 润色前的原文
    polished_text: str          # 润色后的英文；失败时可能是原文降级结果
    explanation: str              # 中文润色说明
    polish_comment: str          # 兼容原有模块的润色说明字段
    polished_audio: bytes          # 润色结果对应的音频字节
    polish_status: str          # success / fallback / failed / skipped
    tts_status: str          # success / skipped / failed


class OverAllState(TypedDict, total=False):
    """整个口语训练系统的全局状态。"""

    # ==================== 消息类状态 ====================

    messages: Annotated[list[AnyMessage], add_messages]

    # ==================== 语音链路（IAT / ISE） ====================

    iat_status: str# ok / no_speech / unavailable
    audio_data: bytes# 麦克风录音 PCM
    audio_file_path: str# ISE 音频文件路径，仅 mock/dev 调试使用
    ref_text: str# ISE 标准参考句
    ise_lang: str# cn / en，缺省 en
    ise_status: str# ok / no_audio / no_ref / unavailable
    ise_xml_info: str# ISE 原始评测 XML
    ise_grade: float | None# 评测总分，无法评测时为 None
    ise_check_results: dict# 发音评测结果及建议

    # ==================== 文本与音频输入 ====================

    raw_text: str# 未清洗的文本
    audio: bytes# 音频数据，保留项目现有字段

    # ==================== 对话上下文 ====================

    role: str# 当前对话角色
    scenario: str# 当前对话场景

    # ==================== 英语表达润色 ====================

    polisher: PolisherOutput
    # 打包输出：original_text / polished_text / explanation / polish_comment
    # polished_audio / polish_status / tts_status

    enable_tts: bool
    # TTS 开关：True 合成语音，False 跳过；调用方控制（父图 audio_choice_node 写入）

    # ==================== 流程控制 ====================

    user_input: str
    has_issue: bool
    new_dialog: bool

    # ==================== 语法辅导 ====================

    issues: list[dict]# 每处语法错误：fragment / error_type / description
    tutor_reply: str# 语法辅导节点输出的纠错讲解
    check_results: dict# 语法及发音问题的结构化结果
    corrections: list# 修正句或示范词结构化结果
    tutor_audio: bytes# 正确句的示范朗读音频
    raw_audio: bytes# 用户原句的朗读音频
    feedback: str# 错误简短概述；无错误时为空字符串
    grammar_check_status: str# ok / empty_input / invalid_input / unavailable

    # ==================== 日志与对话 ID ====================

    talk_ids: Annotated[list[str], add]# 对话 ID 列表，使用 add reducer 追加
    cur_talk_id: str# 当前对话 ID
    logger: list[str]# 父图使用普通 list，接收完整日志列表
    grammar_check_logs: list[str]# 语法检查日志，沿用父图 LastValue 设计


class SubgraphState(TypedDict, total=False):
    """子图状态。

    logger 使用 add reducer：
    子图内部将原有日志与本次新增日志合并。
    父图 logger 使用普通 list：
    父图接收子图输出的完整日志列表。
    """

    # ==================== 消息类状态 ====================

    messages: Annotated[list[AnyMessage], add_messages]

    # ==================== 文本与音频输入 ====================

    raw_text: str# 未清洗的文本
    audio: bytes# 音频数据

    # ==================== 对话上下文 ====================

    role: str
    scenario: str

    # ==================== 英语表达润色 ====================

    polisher: PolisherOutput# 打包输出（同 OverAllState 共享 key）
    enable_tts: bool# TTS 开关（同 OverAllState 共享 key）

    # ==================== 流程控制 ====================

    has_issue: bool
    new_dialog: bool
    user_input: str

    # ==================== 语法辅导 ====================

    issues: list[dict]
    # 每处语法错误：fragment / error_type / description

    tutor_reply: str
    check_results: dict
    corrections: list
    tutor_audio: bytes
    raw_audio: bytes

    # ==================== 日志 ====================

    logger: Annotated[list[str], add]
