
"""英语润色子图的 LangGraph 节点。"""

import logging

from src.talk_agent.state import SubgraphState
from src.talk_agent.subgraphs.polisher_subgraph.polisher_service import polish_text
from src.talk_agent.subgraphs.polisher_subgraph.polisher_tts import synthesize_speech


python_logger = logging.getLogger(__name__)


def polisher_node(state: SubgraphState) -> dict:
    """润色节点：调用业务层，整理结果并写入状态。"""

    raw_text = state.get("raw_text", "")
    user_input = state.get("user_input", "")

    input_text = raw_text or user_input
    if not isinstance(input_text, str):
        input_text = ""

    original_text = input_text
    logger = ["polisher_node: 开始执行"]

    # 初始化完整输出，确保失败时也有明确状态。
    polisher_out = {
        "original_text": original_text,
        "polished_text": original_text,
        "explanation": "",
        "polish_comment": "",
        "polished_audio": b"",
        "polish_status": "fallback",
        "tts_status": "skipped",
    }

    if not original_text.strip():
        explanation = "没有检测到需要润色的英文内容。"
        polisher_out.update({
            "explanation": explanation,
            "polish_comment": explanation,
            "polish_status": "skipped",
        })
        logger.append("polisher_node: 输入为空")
        return {"polisher": polisher_out, "logger": logger}

    try:
        # 业务层负责模型调用、输出校验和有限重试。
        result = polish_text(original_text.strip())

        polisher_out.update({
            # 原文由程序保存，不使用模型生成的副本。
            "original_text": original_text,
            "polished_text": result["polished_text"],
            "explanation": result["explanation"],
            "polish_comment": result["explanation"],
            "polish_status": "success",
        })
        logger.append("polisher_node: 润色成功")

    except Exception:
        python_logger.exception("润色节点执行失败")

        explanation = "润色服务暂时不可用，当前保留原始表达。"
        polisher_out.update({
            "original_text": original_text,
            "polished_text": original_text,
            "explanation": explanation,
            "polish_comment": explanation,
            "polish_status": "fallback",
        })
        logger.append("polisher_node: 润色失败，已回退原文")

    return {
        "polisher": polisher_out,
        "logger": logger,
    }


def tts_node(state: SubgraphState) -> dict:
    """TTS 节点：独立合成润色后的英语语音。"""

    polisher_out = dict(state.get("polisher", {}))
    logger = ["tts_node: 开始执行"]

    if not state.get("enable_tts", False):
        polisher_out["tts_status"] = "skipped"
        polisher_out["polished_audio"] = b""
        logger.append("tts_node: 已关闭 TTS")
        return {"polisher": polisher_out, "logger": logger}

    polished_text = polisher_out.get("polished_text", "")

    if not isinstance(polished_text, str) or not polished_text.strip():
        polisher_out["tts_status"] = "skipped"
        polisher_out["polished_audio"] = b""
        logger.append("tts_node: 没有可合成的文本")
        return {"polisher": polisher_out, "logger": logger}

    try:
        # 具体调用和返回值检查交给 TTS 业务层。
        audio_bytes = synthesize_speech(polished_text)

        polisher_out["polished_audio"] = audio_bytes
        polisher_out["tts_status"] = "success"
        logger.append("tts_node: 语音合成成功")

    except Exception:
        python_logger.exception("TTS 节点执行失败")

        # 只记录 TTS 失败，不覆盖已经生成的润色文本。
        polisher_out["polished_audio"] = b""
        polisher_out["tts_status"] = "failed"
        logger.append("tts_node: 合成失败，保留润色文本")

    return {
        "polisher": polisher_out,
        "logger": logger,
    }
