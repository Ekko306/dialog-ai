
from typing import Annotated, TypedDict

from operator import add

from langchain_core.messages import AnyMessage
from langgraph.graph.message import add_messages

from langgraph.graph import MessagesState, StateGraph, START, END

class OverAllState(TypedDict, total=False):
    # messages 显式声明在 total=False 类内：全部 key 可省略，
    # 节点返回部分更新（如只有 logger）时类型检查才可通过。
    # （MessagesState = 只有 messages 字段的 TypedDict，等价展开而非继承）
    messages: Annotated[list[AnyMessage], add_messages]

    # 语音链路（IAT/ISE）
    iat_status: str  # ok / no_speech / unavailable（语音转写状态；no_speech 时 raw_text=""）
    audio_data: bytes  # 麦克风录音 PCM（ita 节点存入，ISE 节点消费，一次录音两份产出）
    audio_file_path: str  # ISE 音频文件路径（mock/dev 调试用，生产不走）
    ref_text: str  # ISE 标准参考句（教练预设，非 IAT 识别结果）
    ise_lang: str  # 评测语言 cn/en（引擎 ent=cn_vip/en_vip）；缺省 en（产品定位英文学习）
    ise_status: str  # ok / no_audio / no_ref / unavailable（独立于语法状态，不参与路由）
    ise_xml_info: str  # ISE 原始评测 XML（带详细发音错误）
    ise_grade: float | None  # 评测总分（XML total_score 直取；is_rejected/解析失败时为 None）
    ise_check_results: dict  # ise_analyze_node 输出：{"pronunciation":[{word,score,comment}], "advice": str}

    # 逻辑类
    raw_text: str  # 未清洗的文本
    audio: bytes

    # context 快照（子图 hydrate 后经共享 key 回流到父图，父图分支也可直接读）
    role: str
    scenario: str

    # 走分支类状态 （#todo ，改成Command?）
    # 英语表达润色状态
    original_text: str  # 润色前的原文
    polished_text: str  # 润色后的英文
    explanation: str  # 中文润色说明
    polish_comment: str  # 兼容项目原有模块的润色说明字段
    polished_audio: bytes  # polisher 输出：润色后文本的美式发音 MP3

    # 走分支类状态（#todo，后续可考虑改成 Command）
    user_input: str
    has_issue: bool
    new_dialog: bool

    # 语法辅导（grammar_check → grammer_tutor 的契约字段）
    issues: list[str]  # 上游 grammar_check 输出的错误列表
    tutor_reply: str  # grammer_tutor 输出的纠错讲解
    check_results: dict  # 上游 LLM 解析 XML 后的结构化清单（语法错误 + 发音问题）
    corrections: list  # grammer_tutor 输出：修正句/示范词结构化结果（供前端高亮 + TTS 朗读）
    tutor_audio: bytes  # grammer_tutor 输出：正确句的美式发音 MP3（供前端播放示范跟读）
    raw_audio: bytes  # grammer_tutor 输出：用户原句的美式发音 MP3（供前端对照播放原句）
    # grammar_check 子图输出契约（子图 key 必须在父图 schema 声明，否则状态合并失败）
    issues: list[dict]  # 每处语法错误 {fragment, error_type, description}（只标记不纠错，纠错归 tutor）
    feedback: str  # 错误简短概述（不含正确答案）；无错误为空字符串
    grammar_check_status: str  # ok / empty_input / invalid_input / unavailable

    # 日志类
    talk_ids: Annotated[list[str], add]  # 对话 ID，某次图执行
    cur_talk_id: str  # 当前对话 ID

    # LastValue：值由子图输出整体接管（子图内部用 add 累积后整表输出）。
    # 注意：父图层面不要直接写 logger，LastValue 语义下会覆盖而非追加。
    logger: list[str]
    # LastValue：同 logger——子图内 add 累积，父图整表接管（父图节点追加日志需手动 list+append）
    grammar_check_logs: list[str]


class SubgraphState(TypedDict, total=False):
    """子图 schema：logger 挂 add reducer，在子图内部累积。

    机制：子图作为节点挂载时，父图把共享 key 的当前值喂给子图，
    子图按自己的 reducer 跑完后，把最终 channel 值整体输出，
    父图再用父图的 reducer 合并。

    因此两边各持一种语义，避免子图和父图重复追加日志：
    - 子图 logger 带 add：输入日志 + 本次新增日志 → 输出累积列表
    - 父图 logger 使用 LastValue：直接接管子图输出的累积列表
    """

    messages: Annotated[list[AnyMessage], add_messages]

    # 文本类状态
    raw_text: str  # 未清洗的文本
    audio: bytes

    # context 快照：入口节点从 runtime.context/Store 解析一次后写入，
    # 下游节点直接读 state，无需各自调 resolve_context
    role: str
    scenario: str

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

    new_dialog: bool # 默认值None
    user_input: str

