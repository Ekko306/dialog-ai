
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


from src.talk_agent.subgraphs.grammar_check_subgraph.check_conatants import GrammarCheckStatus  # noqa: E402

class CorrectionItem(TypedDict, total=False):
    """corrections 列表元素的结构化标注（纯类型提示，运行时擦除，不改变 channel 语义）。

    仅约束类型供 IDE 提示与静态检查；LLM 侧的强校验由子图 Pydantic schema
    （Correction / TutorOutput + with_structured_output）负责，两者各司其职。
    """

    wrong: str  # 错误片段（原句照抄）
    correct: str  # 修正后的完整句（TTS 整句朗读、前端 ✅ 展示用）
    type: str  # 错误类型（grammar / pronunciation / chinese-style 等）


class OverAllState(TypedDict, total=False):
    """整个口语训练系统的全局状态。"""

    # ==================== 消息类状态 ====================

    messages: Annotated[list[AnyMessage], add_messages]

    # 语音链路（IAT/ISE）
    iat_status: str  # ok / no_speech / unavailable（语音转写状态；no_speech 时 raw_text=""）
    audio_data: bytes  # 麦克风录音 PCM（ita 节点存入，ISE 节点消费，一次录音两份产出）
    audio_file_path: str  # ISE 音频文件路径（mock/dev 调试用，生产不走）
    ref_text: str  # ISE 标准参考句（教练预设优先；未传时自动回退用 IAT 转写文本）
    ise_status: str  # ok / no_audio / no_ref / unavailable（独立于语法状态，不参与路由）
    ise_xml_info: str  # ISE 原始评测 XML（带详细发音错误）
    ise_grade: float | None  # 评测总分（XML total_score 直取；is_rejected/解析失败时为 None）
    ise_check_results: dict  # ise_analyze_node 输出：{"pronunciation":[{word,score,comment}], "advice": str}
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

    # 语法辅导（grammar_check → grammer_tutor 的契约字段）
    # issues 由下方 grammar_check 子图输出契约统一定义（list[dict]；旧 list[str] 重复声明已去重）
    tutor_reply: str  # grammer_tutor 输出的纠错讲解
    check_results: dict  # 上游 LLM 解析 XML 后的结构化清单（语法错误 + 发音问题）
    corrections: list[CorrectionItem]  # 修正句/示范词结构化结果（供前端高亮 + TTS 朗读）
    # 音频输出为公共属性（懒加载）：tutor / polisher 共用；主链不合成，由独立 tts 子图在用户点击发音时按需生成
    tutor_audio: bytes  # 公共音频输出：正确句/润色句的美式发音 MP3（供前端播放示范跟读；懒加载按需合成）
    raw_audio: bytes  # 公共音频输出：用户原句的美式发音 MP3（供前端对照播放；懒加载按需合成）
    # grammar_check 子图输出契约（子图 key 必须在父图 schema 声明，否则状态合并失败）
    issues: list[dict]  # 每处语法错误 {fragment, error_type, description}（只标记不纠错，纠错归 tutor）
    feedback: str  # 错误简短概述（不含正确答案）；无错误为空字符串
    grammar_check_status: GrammarCheckStatus  # 取值域枚举定义在 grammar_check_contracts.py
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

    # 语法辅导（grammar_check → grammer_tutor → coach_reply 的契约字段，与 OverAllState 一致）
    issues: list[dict]  # 每处语法错误 {fragment, error_type, description}（只标记不纠错，纠错归 tutor）
    tutor_reply: str  # grammer_tutor 输出的纠错讲解
    check_results: dict  # 上游 LLM 解析 XML 后的结构化清单（语法错误 + 发音问题）
    ise_xml_info: str  # ISE 原始评测 XML（check 产出，tutor 消费做文本+发音纠错）
    corrections: list[CorrectionItem]  # 修正句/示范词结构化结果（供前端高亮 + TTS 朗读）
    # 音频输出为公共属性（懒加载）：tutor / polisher 共用；主链不合成，由独立 tts 子图在用户点击发音时按需生成
    tutor_audio: bytes  # 公共音频输出：正确句/润色句的美式发音 MP3（供前端播放示范跟读；懒加载按需合成）
    raw_audio: bytes  # 公共音频输出：用户原句的美式发音 MP3（供前端对照播放；懒加载按需合成）
    feedback: str  # 错误简短概述（不含正确答案）；无错误为空字符串
    grammar_check_status: str  # ok / empty_input / invalid_input / unavailable

    # 日志类（add：累积之前的日志 + 本次新增，输出完整列表）
    logger: Annotated[list[str], add]

    new_dialog: bool # 默认值None
    user_input: str
    new_dialog: bool
    user_input: str


class GrammarCheckState(TypedDict, total=False):
    """grammar_check 子图的状态 schema（统一定义在本文件，与 OverAllState 同处维护）。

    与 GrammarVerdict 分开定义的原因：
    GrammarVerdict 是 LLM 的输出契约；Graph State 还要承载
    运行状态（grammar_check_status）和日志等图运行时字段。
    """

    # 输入
    raw_text: str

    # 语音链路（IAT/ISE）：子图经同名共享 key 与父图 OverAllState 互通，
    # 这些字段必须与父图 schema 同名声明，否则运行时 InvalidUpdateError
    iat_status: str  # ok / no_speech / unavailable（语音转写状态；no_speech 时 raw_text=""）
    audio_data: bytes  # 麦克风录音 PCM（ita 存入，ISE 消费，一次录音两份产出）
    audio_file_path: str  # IAT/ISE 音频文件路径（mock/dev/Studio 测试素材）
    ref_text: str  # ISE 标准参考句（教练预设优先；未传时自动回退用 IAT 转写文本）
    ise_status: str  # ok / no_audio / no_ref / unavailable（独立于语法状态）
    ise_xml_info: str  # ISE 原始评测 XML
    ise_grade: float | None  # 评测总分（XML total_score 直取；无效/解析失败为 None）
    ise_check_results: dict  # ise_analyze_node 输出：{"pronunciation":[...], "advice": str}

    # 检查结果（由 grammar_check_node 从 GrammarVerdict 写入；只标记不纠错）
    has_issue: bool
    issues: list[dict]  # 每处错误 {fragment, error_type, description}
    feedback: str  # 错误简短概述（不含正确答案，纠错归下游 tutor）

    # 运行状态取值域见 GrammarCheckStatus（grammar_check_contracts.py）
    grammar_check_status: GrammarCheckStatus

    # 日志：add 累积；字段名独立于父图 logger，避免父子 reducer 冲突
    grammar_check_logs: Annotated[list[str], add]

    user_input: str

