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

结构组织（PR 评审意见落地）：
- 状态契约 GrammarCheckState 统一定义在 src/talk_agent/state.py（与 OverAllState 同处）
- LLM 输出契约 GrammarIssue/GrammarVerdict 单独定义在 grammar_check_contracts.py
- 瞬态错误判定 is_transient 提炼为公共函数（src/talk_agent/utils.py），各节点可复用
- 检查逻辑聚合为 GrammarCheckSubgraph 类：LLM 客户端、节点实现、图构建全收进对象；
  LangGraph 原生支持把编译后的图（Runnable）直接作为节点挂载父图
- 模块级导出名 grammar_check_subgraph 保持不变，父图 / langgraph.json 零改动
"""

import os
import sys
from pathlib import Path

# 兼容直接运行本文件：把 backend 目录加入 sys.path；
# langgraph dev / uv run 下 backend 本就在 sys.path，无副作用
_BACKEND_DIR = Path(__file__).resolve().parents[4]  # 子图包文件比 talk_agent 模块深两级：.../subgraphs/grammar_check_subgraph/xxx.py -> backend
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from dotenv import load_dotenv
from langchain_core.messages import SystemMessage, HumanMessage
from langchain_deepseek import ChatDeepSeek
from langgraph.graph import StateGraph, START, END
from langgraph.types import RetryPolicy  # langgraph 1.x 中 RetryPolicy 位于 langgraph.types
from langgraph.constants import TAG_NOSTREAM  # nostream 标签：把内部 LLM 调用排除出 messages 流

from src.talk_agent.state import GrammarCheckState  # noqa: E402  状态契约统一在 state.py
from src.talk_agent.utils import is_transient  # noqa: E402  公共瞬态判定（PR 评审：提炼为公共函数）
from src.talk_agent.subgraphs.grammar_check_contracts import (  # noqa: E402
    GrammarIssue,  # noqa: F401  re-export：保持原导入路径可用
    GrammarVerdict,
)
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

# 复用 backend/.env（backend/src/talk_agent/subgraphs/grammar_check_subgraph → parents[4] = backend）
load_dotenv(_BACKEND_DIR / ".env")

# ========== 共享工具与常量 ==========


# RetryPolicy = 系统异常重试：只重试 is_transient 认定的瞬态错误，
# 与"用户答错/检查出问题"的正常学习循环完全无关，不要混淆两条路径
# （瞬态判定已提炼为公共函数 src/talk_agent/utils.py，其他节点可复用）
_RETRY_POLICY = RetryPolicy(
    max_attempts=3,
    backoff_factor=2.0,
    initial_interval=1.0,
    retry_on=is_transient,
)

MAX_TEXT_LENGTH = 500  # 输入长度上限：超过视为无效输入


# ========== 子图封装类（检查逻辑聚合对象） ==========


class GrammarCheckSubgraph:
    """语法检查子图的聚合封装：契约 + 模型 + 节点 + 图构建。

    - 持有 LLM 客户端（self.checker）、提示词、各节点实现与编译产物 self.graph
    - ise_analyze_node 实现在独立模块（ise_analyze_node.py），按函数注册
    - LangGraph 原生支持：编译图是 Runnable，可直接 add_node 挂到父图
    """

    GRAMMAR_CHECK_PROMPT = (
        "你是英语语法检查助手，只负责检测和标记用户句子中的语法错误，不要纠错。规则：\n"
        "1. 只判定语法错误：时态、主谓一致、单复数、词性误用等。\n"
        "2. 语法正确但表达不自然的句子不算语法错误，例如 'I agree with you.' 没有语法错误。\n"
        "3. 每处错误标记三要素：fragment=出错的原文片段、error_type=错误类型、description=中文简述错在哪。\n"
        "4. 严禁给出正确答案或修改后的句子（哪怕一个词）——纠错由下游 grammar_tutor 节点负责。\n"
        "5. feedback 只用一句话概述错误类型，同样不含任何正确写法。\n"
        "6. 无语法错误时：has_issue=False，issues 为空列表，feedback 为空字符串。"
    )

    def __init__(self) -> None:
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
            self.checker = model.with_structured_output(GrammarVerdict).with_config(tags=[TAG_NOSTREAM])  # 强制按 Schema 返回
        else:
            self.checker = None
            print("[警告] 未配置 DEEPSEEK_API_KEY，语法检查将降级为 unavailable")

        builder = StateGraph(state_schema=GrammarCheckState)
        # 链路与原主图完全一致：IAT 转写 → ISE 评测 → 发音点评 → 语法检查
        # （各节点重试参数与原主图挂载时完全一致，仅注册位置移入子图）
        for _name, _fn in (
            ("xfyun_ita_tool_node", self.xfyun_ita_tool_node),
            ("xfyun_ise_tool_node", self.xfyun_ise_tool_node),
            ("ise_analyze_node", ise_analyze_node),
            ("grammar_check_node", self.grammar_check_node),
        ):
            builder.add_node(_name, _fn, retry_policy=_RETRY_POLICY)
        builder.add_edge(START, "xfyun_ita_tool_node")
        builder.add_edge("xfyun_ita_tool_node", "xfyun_ise_tool_node")
        builder.add_edge("xfyun_ise_tool_node", "ise_analyze_node")
        builder.add_edge("ise_analyze_node", "grammar_check_node")
        builder.add_edge("grammar_check_node", END)
        self.graph = builder.compile()

    # ---- 节点实现（原模块级函数收进类；ise_analyze_node 留在独立模块） ----

    def xfyun_ita_tool_node(self, state: GrammarCheckState) -> GrammarCheckState:
        """IAT 语音转写节点（加固版）：讯飞听写 → raw_text + 音频字节存 State。

        - 输入优先级：audio_data（上游复用）> audio_file_path（mock/dev/Studio 测试素材）
          > 麦克风（生产路径）；有音频就转写它，不开麦、不卡 input()
        - 麦克风录音只发生一次：文本走语法链，PCM 存 State 喂 ISE（一次录音两份产出）
        - 瞬态异常上抛 → RetryPolicy；非瞬态（401/无麦克风/EOF/KeyError）→ unavailable 降级
        - 空识别结果（没说话/纯噪声/英文音频走中文引擎转不出）→ no_speech，raw_text=""
          （下游 empty_input → fallback 兜底，不会炸图）
        """
        audio_bytes = state.get("audio_data")

        # audio_file = (state.get("audio_file_path") or "").strip()
        audio_file = (state.get("user_input") or "").strip()  # todo 优化逻辑， 现在是输入文件路径，以后会是前端传入直接音频文件到接口
        print(f"test_audio_file:{audio_file}")

        try:
            if audio_bytes or audio_file:
                # 已有音频 → 直接转写它（测试素材/上游复用路径）
                if audio_bytes:
                    text = xfyun_iat_tool_by_audio_data(audio_bytes)
                else:
                    text = xfyun_iat_tool_by_audio_file(audio_file)
                audio = audio_bytes or b""
            else:
                text, audio = xfyun_iat_tool_by_mic()  # 生产路径：真实麦克风录音
        except Exception as e:
            if is_transient(e):
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

    def xfyun_ise_tool_node(self, state: GrammarCheckState) -> GrammarCheckState:
        """ISE 发音评测节点：同一次录音的 PCM + 预设参考句 → 评测 XML 存进 State。

        - 输入优先级：audio_data（生产主路径，来自 ita 存的录音 PCM）
                      > audio_file_path（mock/dev 调试用）> 没音频 → no_audio 短路
        - ref_text 优先用教练预设句；未传时自动回退用 IAT 转写文本
          （"跟读自己"单输入模式：无需预设答案，识别到什么就评什么；
          代价：ASR 自动纠错会让参考句失真，is_rejected 校验形同虚设）；
          两者都没有 → no_ref 短路
        - 评测引擎默认英文（工具层 ent 缺省 en_vip，调用处无需传参）；
          多语言支持等后续有场景需求时再单独加回
        - 瞬态异常上抛 → RetryPolicy 重试；非瞬态/空结果 → unavailable 降级
        - ise_status 独立于 grammar_check_status，ISE 失败绝不阻塞语法主链路
        """
        ref = (state.get("ref_text") or "").strip()
        audio_bytes = state.get("audio_data")

        # audio_file = (state.get("audio_file_path") or "").strip()
        audio_file = (state.get("user_input") or "").strip()  # todo 优化逻辑， 现在是输入文件路径，以后会是前端传入直接音频文件到接口
        print(f"test_audio_file:{audio_file}")

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
                xml = xfyun_ise_tool_by_audio_data(audio_bytes, answer_text=ref)  # ent 缺省 en_vip
            else:
                xml = xfyun_ise_tool_by_audio_file(audio_file, answer_text=ref)  # ent 缺省 en_vip
        except Exception as e:
            if is_transient(e):
                raise  # 瞬态上抛 → RetryPolicy；3 次耗尽由调用方兜底
            return {"ise_status": "unavailable", "ise_xml_info": ""}
        if not (xml or "").strip():
            return {"ise_status": "unavailable", "ise_xml_info": ""}
        # 总分直取（已归一化为百分制）：XML 里的确定性数据不等 LLM；is_rejected 分数作废 / 解析失败 → None
        grade = None
        info = parse_ise_xml(xml, max_score=5.0)  # 英文引擎 5 分制（解析层归一化成百分制）
        if info and not info["is_rejected"] and info["total"]:
            grade = float(info["total"])  # _pct 已兜住坏值（返回 None 不会进到这里）
        out = {"ise_status": "ok", "ise_xml_info": xml, "ise_grade": grade}
        if auto_ref:  # 标记自证模式，方便 trace/调试追溯
            out["grammar_check_logs"] = [
                "xfyun_ise_tool_node：未传 ref_text，自动以 IAT 转写文本作为参考句（自证模式）"
            ]
        return out

    def grammar_check_node(self, state: GrammarCheckState) -> GrammarCheckState:
        """LLM 语法检查节点：结构化输出 GrammarVerdict → 只标记不纠错。"""
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
        if self.checker is None:
            return {
                "grammar_check_status": "unavailable",
                "grammar_check_logs": [
                    "grammar_check_node：未配置 DEEPSEEK_API_KEY → unavailable"
                ],
            }

        try:
            verdict: GrammarVerdict = self.checker.invoke(
                [
                    SystemMessage(content=self.GRAMMAR_CHECK_PROMPT),
                    HumanMessage(content=raw_text),
                ]
            )
        except Exception as e:
            # 分层容错：异常必须"能传播出去"RetryPolicy 才有机会重试——
            # 如果这里全部吞掉转 unavailable，重试机制就永远不会触发
            if is_transient(e):
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


# ========== 对外导出（名字不变：父图 / langgraph.json 零改动） ==========
grammar_check_subgraph = GrammarCheckSubgraph().graph

if __name__ == "__main__":
    # 独立运行本子图：入口已是 xfyun_ita_tool_node（语音链路），
    # 无 audio_data/audio_file_path 时会请求麦克风录音，再走全链路
    # （stream_mode="updates"：逐节点打印状态写入，终端可观测）
    grammar_check_subgraph.invoke({})
