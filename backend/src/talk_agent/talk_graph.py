import sys
from pathlib import Path

# 兼容直接运行本文件（python graph.py）：把 backend 目录加入 sys.path，
# 使 src.* 绝对导入可用；langgraph dev / uv run 下 backend 本就在 sys.path，无副作用
_BACKEND_DIR = Path(__file__).resolve().parents[2]  # backend/src/talk_agent/graph.py -> backend
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from langgraph.graph import StateGraph,START,END  # noqa: E402
from langgraph.types import RetryPolicy, interrupt  # noqa: E402

from src.talk_agent.state import OverAllState  # noqa: E402
from src.talk_agent.ise_analyze_node import ise_analyze_node, parse_ise_xml  # noqa: E402
from src.talk_agent.subgraphs.grammar_check_subgraph import grammar_check_subgraph  # noqa: E402

from src.talk_agent.subgraphs.grammer_tutor_subgraph import grammer_tutor_subgraph  # noqa: E402
from src.talk_agent.subgraphs.polisher_subgraph import polisher_subgraph  # noqa: E402

from src.talk_agent.subgraphs.coach_reply_subgraph import coach_reply_subgraph  # noqa: E402
from typing import Literal  # noqa: E402
from src.tools.audio_tool.xfyun_ita.xfyun_iat_tool import (  # noqa: E402
    xfyun_iat_tool_by_mic,
    xfyun_iat_tool_by_audio_data,
    xfyun_iat_tool_by_audio_file,
)
from src.tools.audio_tool.xfyun_ise.xfyun_ise_tool import (  # noqa: E402
    xfyun_ise_tool_by_audio_data,
    xfyun_ise_tool_by_audio_file,
)
from src.tools.text_tool.scene_tool import new_scene_tool  # noqa: E402


# ========== 教练交互（HITL / 场景切换，来自 origin/main） ==========


def tts_tool_node(state: OverAllState) -> OverAllState:
    pass


def HITL_node(state: OverAllState) -> OverAllState:
    user_input = interrupt({"prompt": "请输入指令（输入 'context切换' 进入下一个教练场景）"})
    return {
        "user_input": user_input
    }


def HITL_route(state: OverAllState) -> Literal["new_context", "ita_audio"]:
    user_input = state.get("user_input", "")
    if "_new_context_" in user_input:
        return "new_context"
    else:
        return "ita_audio"

# new_context分支
def new_context_node(state: OverAllState) -> OverAllState:
    user_input = state.get("user_input", "")
    # 1. 调用工具获取新场景
    new_scene = new_scene_tool(user_input)
    # 2. 保存到store
    pass


# ========== 语音链路（IAT / ISE / 分析，来自 hana） ==========
# ita 节点取 hana 加固版：兼容 audio_data/audio_file 入参 + 异常降级，
# origin/main 的麦克风版行为是其无音频入参时的默认路径，语义为超集


def xfyun_ita_tool_node(state: OverAllState) -> OverAllState:
    """IAT 语音转写节点（加固版）：讯飞听写 → raw_text + 音频字节存 State。

    - 输入优先级：audio_data（上游复用）> audio_file_path（mock/dev/Studio 测试素材）
      > 麦克风（生产路径）；有音频就转写它，不开麦、不卡 input()
    - 麦克风录音只发生一次：文本走语法链，PCM 存 State 喂 ISE（一次录音两份产出）
    - 瞬态异常上抛 → RetryPolicy；非瞬态（401/无麦克风/EOF/KeyError）→ unavailable 降级
    - 空识别结果（没说话/纯噪声/英文音频走中文引擎转不出）→ no_speech，raw_text=""
      （下游 empty_input → fallback 兜底，不会炸图）
    """
    audio_bytes = state.get("audio_data")
    audio_file = (state.get("audio_file_path") or "").strip()
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


def xfyun_ise_tool_node(state: OverAllState) -> OverAllState:
    """ISE 发音评测节点：同一次录音的 PCM + 预设参考句 → 评测 XML 存进 State。

    - 输入优先级：audio_data（生产主路径，来自 ita 存的录音 PCM）
                  > audio_file_path（mock/dev 调试用）> 没音频 → no_audio 短路
    - ref_text 用教练预设句（不从 raw_text 取，避免自证循环）；
      有音频但没参考句（终端麦克风流程不传 ref_text）→ no_ref 短路
    - ise_lang 选评测引擎语言（cn/en，缺省 en=英文，产品定位），
      工具层映射 ent=cn_vip/en_vip；英文引擎逐词有真实分数，中文没有
    - 瞬态异常上抛 → RetryPolicy 重试；非瞬态/空结果 → unavailable 降级
    - ise_status 独立于 grammar_check_status，ISE 失败绝不阻塞语法主链路
    """
    ref = (state.get("ref_text") or "").strip()
    audio_bytes = state.get("audio_data")
    audio_file = (state.get("audio_file_path") or "").strip()
    # 评测语言：产品定位英文学习 → 缺省 en；State 传 "cn" 可切中文引擎
    lang = (state.get("ise_lang") or "en").strip().lower()
    ent = f"{lang}_vip"
    if not audio_bytes and not audio_file:
        return {"ise_status": "no_audio", "ise_xml_info": ""}
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
    return {"ise_status": "ok", "ise_xml_info": xml, "ise_grade": grade}


def grammar_check_fallback_node(state: OverAllState) -> OverAllState:
    """语法检查未完成（empty_input / invalid_input / unavailable）时的兜底占位节点。

    占位实现：只记录失败原因，等团队后续决定兜底话术如何回给用户。
    """
    status = state.get("grammar_check_status", "unknown")
    # grammar_check_logs 在父图是 LastValue（整表接管），父图节点追加日志需手动合并
    logs = list(state.get("grammar_check_logs", []))
    logs.append(f"grammar_check_fallback_node：语法检查未完成({status})，走兜底分支")
    return {"grammar_check_logs": logs}


# 定义节点
parent_builder = StateGraph(state_schema=OverAllState)
# —— 教练交互侧（origin/main）——
parent_builder.add_node("coach_reply_subgraph", coach_reply_subgraph)
parent_builder.add_node("tts_tool_node", new_context_node)
parent_builder.add_node("HITL_node", HITL_node)
parent_builder.add_node("new_context_node", new_context_node)
# —— 语音链路侧（hana，带 RetryPolicy）——
parent_builder.add_node(
    "xfyun_ita_tool_node",
    xfyun_ita_tool_node,
    retry_policy=RetryPolicy(max_attempts=3, backoff_factor=2.0, initial_interval=1.0, retry_on=_is_transient),
)
parent_builder.add_node(
    "xfyun_ise_tool_node",
    xfyun_ise_tool_node,
    retry_policy=RetryPolicy(max_attempts=3, backoff_factor=2.0, initial_interval=1.0, retry_on=_is_transient),
)
parent_builder.add_node(
    "ise_analyze_node",
    ise_analyze_node,
    retry_policy=RetryPolicy(max_attempts=3, backoff_factor=2.0, initial_interval=1.0, retry_on=_is_transient),
)
# —— 语法链路侧 ——
parent_builder.add_node("grammar_check_subgraph", grammar_check_subgraph)
parent_builder.add_node("grammer_tutor_subgraph", grammer_tutor_subgraph)
parent_builder.add_node("polisher_subgraph", polisher_subgraph)
parent_builder.add_node("grammar_check_fallback_node", grammar_check_fallback_node)


# 定义自定义路由：三分支——检查成功按 has_issue 走纠错/润色；
# 检查未完成一律 check_failed，绝不能把"没检查成"当成"没有语法问题"
# （取 hana 的 my_route 取代 origin/main 的两分支 has_issue_route：
#   两边共同的 path_map 上下文本就是三分支，check_failed 需要兜底出口）
def my_route(state: OverAllState) -> Literal["has_issue", "has_no_issue", "check_failed"]:
    if state.get("grammar_check_status") != "ok" or state.get("has_issue") is None:
        return "check_failed"

    return "has_issue" if state.get("has_issue") else "has_no_issue"


# 定义边
# 教练开场 → TTS → HITL 等待用户输入（origin/main 的多轮交互入口）
parent_builder.add_edge(START, "coach_reply_subgraph")
parent_builder.add_edge("coach_reply_subgraph", "tts_tool_node")
parent_builder.add_edge("tts_tool_node", "HITL_node")
parent_builder.add_conditional_edges("HITL_node", HITL_route, path_map={
    "new_context": "new_context_node",
    "ita_audio": "xfyun_ita_tool_node",
})

# new_context分支
parent_builder.add_edge("new_context_node", END)

# ita_audio分支：语音链路（hana 的 ISE 全链路）
parent_builder.add_edge("xfyun_ita_tool_node", "xfyun_ise_tool_node")
parent_builder.add_edge("xfyun_ise_tool_node", "ise_analyze_node")
parent_builder.add_edge("ise_analyze_node", "grammar_check_subgraph")
parent_builder.add_conditional_edges("grammar_check_subgraph", my_route, path_map={
    "has_issue": "grammer_tutor_subgraph",
    "has_no_issue": "polisher_subgraph",
    "check_failed": "grammar_check_fallback_node",
})
# has_issue分支
parent_builder.add_edge("grammer_tutor_subgraph", "coach_reply_subgraph")
# has_no_issue分支
parent_builder.add_edge("polisher_subgraph", "coach_reply_subgraph")
# 兜底分支同样汇入 coach_reply 统一产出本轮回复
# （coach 端实现时可依据 grammar_check_status 生成失败提示话术）
parent_builder.add_edge("grammar_check_fallback_node", "coach_reply_subgraph")
parent_builder.add_edge("coach_reply_subgraph", END)

# 构建图
graph = parent_builder.compile()

if __name__ == "__main__":
    # 运行结果不打印到终端：trace 自动上传 LangSmith（new-agent 项目），在网页端查看
    # 终端只保留语音交互提示（回车开始/结束录音）
    graph.invoke({})
    from langsmith import Client  # 局部导入：作为模块被导入时不引入 langsmith

    Client().flush()  # 等 trace 上传完成再退出，避免进程提前结束丢最后一条
    print("本轮运行结束，trace 已上传 → 浏览器打开 https://smith.langchain.com → Tracing → new-agent 查看")
