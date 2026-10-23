"""grammar_check 子图：语音链路 + 语法检查模块（ LangGraph 官网规范结构）。

职责边界：
- 承接完整语音链路：IAT 语音转写（xfyun_ita_tool_node）→ ISE 发音评测
  （xfyun_ise_tool_node）→ 发音点评（ise_analyze_node）→ 语法检查（grammar_check_node），
  与原主图的节点执行顺序完全一致
- 只检测硬语法错误（时态/主谓一致/单复数/词性误用），
  语法正确但不自然的表达留给润色模块（polisher）
- 输出结构化契约字段（has_issue/issues/feedback），只检测标记不纠错：
  纠错由下游 grammar_tutor 负责，本子图严禁给出正确答案

容错分层（RetryPolicy 与异常传播的约定）：
- 瞬态错误（连接失败/超时/5xx）→ 节点内上抛，RetryPolicy 指数退避重试
- 非瞬态错误（如 401 认证失败）→ 就地转 grammar_check_status="unavailable"
- 输入异常（空/超长）→ empty_input / invalid_input，不伪装成 has_issue=False
"""

import os
import sys
from pathlib import Path

# 兼容直接运行本文件：把 backend 目录加入 sys.path；
# langgraph dev / uv run 下 backend 本就在 sys.path，无副作用
_BACKEND_DIR = Path(__file__).resolve().parents[3]  # subgraphs 比 graph.py 深一层
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from operator import add
from typing import Annotated, TypedDict

from dotenv import load_dotenv
from pydantic import BaseModel, Field
from langchain_core.messages import SystemMessage, HumanMessage
from langchain_deepseek import ChatDeepSeek
from langgraph.graph import StateGraph, START, END
from langgraph.types import RetryPolicy  # langgraph 1.x 中 RetryPolicy 位于 langgraph.types
from langgraph.constants import TAG_NOSTREAM  # nostream 标签：把内部 LLM 调用排除出 messages 流

from src.talk_agent.subgraphs.grammar_check_subgraph.ise_analyze_node import ise_analyze_node, parse_ise_xml  # noqa: E402
from src.tools.audio_tool.xfyun_ita.xfyun_iat_tool import (  # noqa: E402
    xfyun_iat_tool_by_mic,
    xfyun_iat_tool_by_audio_data,
    xfyun_iat_tool_by_audio_file,
)
from src.tools.audio_tool.xfyun_ise.xfyun_ise_tool import (  # noqa: E402
    xfyun_ise_tool_by_audio_data,
    xfyun_ise_tool_by_audio_file,
)

# 复用 backend/.env（backend/src/talk_agent/subgraphs → parents[3] = backend）
load_dotenv(_BACKEND_DIR / ".env")

# ========== Schema 定义 ==========


class GrammarIssue(BaseModel):
    """单个语法错误的定位标记——只标记不纠错，纠错由下游 grammar_tutor 负责。"""

    fragment: str = Field(description="出错的原文片段，用于定位错误位置")
    error_type: str = Field(description="错误类型：时态/主谓一致/单复数/词性误用等")
    description: str = Field(description="中文简述错在哪里；禁止给出正确答案或改写后的句子")


class GrammarVerdict(BaseModel):
    """LLM 结构化输出契约：语法检查结果（只检测标记，不纠错）。

    只描述"LLM 应该返回什么"，不包含图运行时字段
    （grammar_check_status 等由节点逻辑决定，不由 LLM 决定）。
    """

    has_issue: bool = Field(
        description=(
            "句子是否存在真正的语法错误（时态、主谓一致、单复数、词性误用等）。"
            "语法正确但表达不够自然不算语法错误。"
        )
    )
    issues: list[GrammarIssue] = Field(
        description="每处语法错误的定位标记（位置/类型/简述）；无错误时为空列表。"
    )
    feedback: str = Field(
        description=(
            "面向学习者的中文一句话概述（有哪些类型的错误）；"
            "禁止给出正确答案或修改后的句子；无错误时为空字符串。"
        )
    )


class GrammarCheckState(TypedDict, total=False):
    """grammar_check 子图的状态 schema。

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
    ise_lang: str  # 评测语言 cn/en（缺省 en）；工具层映射 ent=cn_vip/en_vip
    ise_status: str  # ok / no_audio / no_ref / unavailable（独立于语法状态）
    ise_xml_info: str  # ISE 原始评测 XML
    ise_grade: float | None  # 评测总分（XML total_score 直取；无效/解析失败为 None）
    ise_check_results: dict  # ise_analyze_node 输出：{"pronunciation":[...], "advice": str}

    # 检查结果（由 grammar_check_node 从 GrammarVerdict 写入；只标记不纠错）
    has_issue: bool
    issues: list[dict]  # 每处错误 {fragment, error_type, description}
    feedback: str  # 错误简短概述（不含正确答案，纠错归下游 tutor）

    # 运行状态：ok / empty_input / invalid_input / unavailable
    grammar_check_status: str

    # 日志：add 累积；字段名独立于父图 logger，避免父子 reducer 冲突
    grammar_check_logs: Annotated[list[str], add]

    user_input: str


# ========== 模型配置（checker 依赖 GrammarVerdict） ==========

# ChatDeepSeek 在构造时就会校验 api_key，
# 所以没配置 key 时不建模型，让节点走 unavailable 降级路径
_api_key = os.getenv("DEEPSEEK_API_KEY")
if _api_key:
    model = ChatDeepSeek(
        model=os.getenv("DEEPSEEK_MODEL", "deepseek-chat"),
        api_key=_api_key,
        temperature=0,  # 语法判定要稳定，不要创造性
    )
    # TAG_NOSTREAM：结构化输出底层是 function calling，其 tool_call chunks 若流入
    # stream_mode="messages" 会在前端渲染成幽灵 "Used Tool" 消息且跨轮合并，必须排除
    checker = model.with_structured_output(GrammarVerdict).with_config(tags=[TAG_NOSTREAM])  # 强制按 Schema 返回
else:
    model = None
    checker = None
    print("[警告] 未配置 DEEPSEEK_API_KEY，语法检查将降级为 unavailable")

GRAMMAR_CHECK_PROMPT = (
    "你是英语语法检查助手，只负责检测和标记用户句子中的语法错误，不要纠错。规则：\n"
    "1. 只判定语法错误：时态、主谓一致、单复数、词性误用等。\n"
    "2. 语法正确但表达不自然的句子不算语法错误，例如 'I agree with you.' 没有语法错误。\n"
    "3. 每处错误标记三要素：fragment=出错的原文片段、error_type=错误类型、description=中文简述错在哪。\n"
    "4. 严禁给出正确答案或修改后的句子（哪怕一个词）——纠错由下游 grammar_tutor 节点负责。\n"
    "5. feedback 只用一句话概述错误类型，同样不含任何正确写法。\n"
    "6. 无语法错误时：has_issue=False，issues 为空列表，feedback 为空字符串。"
)

# ========== 语音链路节点（从 graph.py 搬入） ==========

_AUDIO_SUFFIXES = {".pcm", ".wav", ".mp3", ".m4a"}


def _is_audio_path(candidate: str) -> bool:
    """判定 user_input 是否为音频文件路径：音频后缀且文件真实存在.

    双条件防误判——前端语音输入的 user_input 是讯飞转写文本而非路径，
    只有同时满足音频后缀与 os.path.isfile 才走旧的文件转写/评测测试通道。
    """
    if not candidate:
        return False
    if Path(candidate).suffix.lower() not in _AUDIO_SUFFIXES:
        return False
    return os.path.isfile(candidate)


def xfyun_ita_tool_node(state: GrammarCheckState) -> GrammarCheckState:
    """IAT 语音转写节点（加固版）：讯飞听写 → raw_text + 音频字节存 State。

    - 输入优先级：audio_data（上游复用）> user_input 为音频文件路径（旧测试通道保留）
      > user_input 已转写文本直通（前端语音输入，不调 IAT 不开麦）> 麦克风（生产路径）
    - 麦克风录音只发生一次：文本走语法链，PCM 存 State 喂 ISE（一次录音两份产出）
    - 瞬态异常上抛 → RetryPolicy；非瞬态（401/无麦克风/EOF/KeyError）→ unavailable 降级
    - 空识别结果（没说话/纯噪声/英文音频走中文引擎转不出）→ no_speech，raw_text=""
      （下游 empty_input → fallback 兜底，不会炸图）
    """
    audio_bytes = state.get("audio_data")
    candidate = (state.get("user_input") or "").strip()
    # user_input 语义自适应：音频文件路径 → 旧测试通道；否则视为前端语音转写文本直通
    audio_file = candidate if _is_audio_path(candidate) else ""
    text_input = candidate if candidate and not audio_file else ""

    try:
        if audio_bytes:
            # 上游复用音频 → 直接转写它（一次录音两份产出）
            text = xfyun_iat_tool_by_audio_data(audio_bytes)
            audio = audio_bytes
        elif audio_file:
            # 音频文件路径（mock/dev/Studio 测试通道保留）
            text = xfyun_iat_tool_by_audio_file(audio_file)
            audio = b""
        elif text_input:
            # 前端语音输入：user_input 已是讯飞转写文本，直通语法链（不调 IAT、不开麦）
            return {"iat_status": "ok", "raw_text": text_input}
        else:
            text, audio = xfyun_iat_tool_by_mic()  # 生产路径：真实麦克风录音
    except Exception as e:
        if _is_transient(e):
            raise  # 瞬态上抛 → RetryPolicy；3 次耗尽由调用方兜底
        return {
            "iat_status": "unavailable",
            "raw_text": "",
            "grammar_check_logs": [f"xfyun_ita_tool_node：语音识别失败({type(e).__name__}) → unavailable"],
        }
    if not (text or "").strip():
        return {
            "iat_status": "no_speech",
            "raw_text": "",
            "audio_data": audio or b"",
            "grammar_check_logs": ["xfyun_ita_tool_node：未识别到有效语音 → no_speech"],
        }
    # 录音只发生一次：文本走语法链，PCM 存 State 喂 ISE（发音评测复用同一份音频）
    return {"iat_status": "ok", "raw_text": text, "audio_data": audio}


def _is_transient(e: Exception) -> bool:
    """瞬态错误判定（与 grammar_check 节点同款）：连接失败/超时/5xx 可重试。"""
    if isinstance(e, (ConnectionError, TimeoutError)):
        return True
    status = getattr(e, "status_code", None)
    return isinstance(status, int) and status >= 500


def xfyun_ise_tool_node(state: GrammarCheckState) -> GrammarCheckState:
    """ISE 发音评测节点：同一次录音的 PCM + 预设参考句 → 评测 XML 存进 State。

    - 输入优先级：audio_data（生产主路径，来自 ita 存的录音 PCM）
                  > user_input 为音频文件路径（mock/dev 调试通道保留）
                  > 没音频（含 user_input 为转写文本时）→ no_audio 短路
    - ref_text 优先用教练预设句；未传时自动回退用 IAT 转写文本
      （"跟读自己"单输入模式：无需预设答案，识别到什么就评什么；
      代价：ASR 自动纠错会让参考句失真，is_rejected 校验形同虚设）；
      两者都没有 → no_ref 短路
    - ise_lang 选评测引擎语言（cn/en，缺省 en=英文，产品定位），
      工具层映射 ent=cn_vip/en_vip；英文引擎逐词有真实分数，中文没有
    - 瞬态异常上抛 → RetryPolicy 重试；非瞬态/空结果 → unavailable 降级
    - ise_status 独立于 grammar_check_status，ISE 失败绝不阻塞语法主链路
    """
    ref = (state.get("ref_text") or "").strip()
    audio_bytes = state.get("audio_data")

    candidate = (state.get("user_input") or "").strip()
    # 同 ita 节点：user_input 仅在为音频文件路径时走文件评测；转写文本无音频 → no_audio 短路
    audio_file = candidate if _is_audio_path(candidate) else ""

    # 评测语言：产品定位英文学习 → 缺省 en；State 传 "cn" 可切中文引擎
    lang = (state.get("ise_lang") or "en").strip().lower()
    ent = f"{lang}_vip"
    if not audio_bytes and not audio_file:
        return {"ise_status": "no_audio", "ise_xml_info": ""}
    auto_ref = False
    if not ref:
        # 单输入模式：未传教练预设句 → 自动用 IAT 转写文本当参考句（识别到什么评什么）；
        # 显式传了 ref_text 仍优先，此处只是兜底
        ref = (state.get("raw_text") or "").strip()
        auto_ref = bool(ref)
    if not ref:
        return {"ise_status": "no_ref", "ise_xml_info": ""}
    try:
        if audio_bytes:
            xml = xfyun_ise_tool_by_audio_data(audio_bytes, answer_text=ref, ent=ent)
        else:
            xml = xfyun_ise_tool_by_audio_file(audio_file, answer_text=ref, ent=ent)
    except Exception as e:
        if _is_transient(e):
            raise  # 瞬态上抛 → RetryPolicy；3 次耗尽由调用方兜底
        return {"ise_status": "unavailable", "ise_xml_info": ""}
    if not (xml or "").strip():
        return {"ise_status": "unavailable", "ise_xml_info": ""}
    # 总分直取（已归一化为百分制）：XML 里的确定性数据不等 LLM；is_rejected 分数作废 / 解析失败 → None
    grade = None
    info = parse_ise_xml(xml, max_score=100.0 if lang == "cn" else 5.0)
    if info and not info["is_rejected"] and info["total"]:
        grade = float(info["total"])  # _pct 已兜住坏值（返回 None 不会进到这里）
    out = {"ise_status": "ok", "ise_xml_info": xml, "ise_grade": grade}
    if auto_ref:  # 标记自证模式，方便 trace/调试追溯
        out["grammar_check_logs"] = [
            "xfyun_ise_tool_node：未传 ref_text，自动以 IAT 转写文本作为参考句（自证模式）"
        ]
    return out


# ========== 节点 ==========

MAX_TEXT_LENGTH = 500  # 输入长度上限：超过视为无效输入


def _is_transient(e: Exception) -> bool:
    """判断是否为"瞬态"系统异常——重试有机会成功的错误。

    重试：连接失败、超时、服务端 5xx（duck-typing 读 status_code，
    兼容 openai/httpx 异常，无需导入具体类型）
    不重试：401 认证失败、400 参数错误等客户端错误（重试也不会好）
    """
    if isinstance(e, (ConnectionError, TimeoutError)):
        return True
    status = getattr(e, "status_code", None)
    return isinstance(status, int) and status >= 500


def grammar_check_node(state: GrammarCheckState) -> GrammarCheckState:
    raw_text = state.get("raw_text", "")

    # 出口1：空文本——根本没有完成有效检查，
    # 不能返回 has_issue=False（那会被父图理解成"没有语法问题"）
    if not raw_text.strip():
        return {
            "grammar_check_status": "empty_input",
            "grammar_check_logs": ["grammar_check_node：输入为空 → empty_input"],
        }

    # 出口2：超长文本
    if len(raw_text) > MAX_TEXT_LENGTH:
        return {
            "grammar_check_status": "invalid_input",
            "grammar_check_logs": [
                f"grammar_check_node：输入超长({len(raw_text)}>{MAX_TEXT_LENGTH}) → invalid_input"
            ],
        }

    # 出口3：正常输入——调用 LLM 结构化输出做语法检查
    if checker is None:
        return {
            "grammar_check_status": "unavailable",
            "grammar_check_logs": [
                "grammar_check_node：未配置 DEEPSEEK_API_KEY → unavailable"
            ],
        }

    try:
        verdict: GrammarVerdict = checker.invoke(
            [
                SystemMessage(content=GRAMMAR_CHECK_PROMPT),
                HumanMessage(content=raw_text),
            ]
        )
    except Exception as e:
        # 分层容错：异常必须"能传播出去"RetryPolicy 才有机会重试——
        # 如果这里全部吞掉转 unavailable，重试机制就永远不会触发
        if _is_transient(e):
            raise  # 瞬态异常(连接失败/超时/5xx)上抛 → RetryPolicy 指数退避重试；
            #        3次耗尽后异常继续上抛，由调用方(Gateway层)最终兜底
        return {  # 非瞬态错误(如401认证失败)重试也不会好 → 直接 unavailable
            "grammar_check_status": "unavailable",
            "grammar_check_logs": [
                f"grammar_check_node：LLM 调用失败({type(e).__name__}: {e}) → unavailable"
            ],
        }

    return {
        "grammar_check_status": "ok",
        "has_issue": verdict.has_issue,
        "issues": [issue.model_dump() for issue in verdict.issues],
        "feedback": verdict.feedback,
        "grammar_check_logs": ["grammar_check_node：LLM 语法检查完成（只标记不纠错）"],
    }


# ========== 构建子图 ==========
builder = StateGraph(state_schema=GrammarCheckState)

# RetryPolicy = 系统异常重试：只重试 _is_transient 认定的瞬态错误，
# 与"用户答错/检查出问题"的正常学习循环完全无关，不要混淆两条路径
# （各节点重试参数与原主图挂载时完全一致，仅注册位置移入子图）
builder.add_node(
    "xfyun_ita_tool_node",
    xfyun_ita_tool_node,
    retry_policy=RetryPolicy(
        max_attempts=3,
        backoff_factor=2.0,
        initial_interval=1.0,
        retry_on=_is_transient,
    ),
)
builder.add_node(
    "xfyun_ise_tool_node",
    xfyun_ise_tool_node,
    retry_policy=RetryPolicy(
        max_attempts=3,
        backoff_factor=2.0,
        initial_interval=1.0,
        retry_on=_is_transient,
    ),
)
builder.add_node(
    "ise_analyze_node",
    ise_analyze_node,
    retry_policy=RetryPolicy(
        max_attempts=3,
        backoff_factor=2.0,
        initial_interval=1.0,
        retry_on=_is_transient,
    ),
)
builder.add_node(
    "grammar_check_node",
    grammar_check_node,
    retry_policy=RetryPolicy(
        max_attempts=3,
        backoff_factor=2.0,
        initial_interval=1.0,
        retry_on=_is_transient,
    ),
)

# 链路与原主图完全一致：IAT 转写 → ISE 评测 → 发音点评 → 语法检查
builder.add_edge(START, "xfyun_ita_tool_node")
builder.add_edge("xfyun_ita_tool_node", "xfyun_ise_tool_node")
builder.add_edge("xfyun_ise_tool_node", "ise_analyze_node")
builder.add_edge("ise_analyze_node", "grammar_check_node")
builder.add_edge("grammar_check_node", END)

grammar_check_subgraph = builder.compile()

if __name__ == "__main__":
    # 独立运行本子图：入口已是 xfyun_ita_tool_node（语音链路），
    # 无 audio_data/audio_file_path 时会请求麦克风录音，再走全链路
    # （stream_mode="updates"：逐节点打印状态写入，终端可观测）
    grammar_check_subgraph.invoke({})
