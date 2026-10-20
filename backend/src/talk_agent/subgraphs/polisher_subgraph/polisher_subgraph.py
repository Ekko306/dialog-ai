
"""英语口语表达润色子图。

职责：
1. 加载英语表达润色 Skill。
2. 调用模型生成润色结果和中文解释。
3. 可选地使用科大讯飞 TTS 合成润色后的英文。
4. 将结果写回子图状态。
"""

import sys
import logging
from pathlib import Path
from typing import Any

# 兼容直接运行当前文件：把 backend 目录加入 sys.path，使 src.* 绝对导入可用。
# 当前文件位于 backend/src/talk_agent/subgraphs/polisher_subgraph/ 下，
# parents[4] 才对应 backend 目录。
_BACKEND_DIR = Path(__file__).resolve().parents[4]

if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from dotenv import load_dotenv  # noqa: E402
from langgraph.graph import StateGraph, START, END  # noqa: E402

from src.llm_models.get_model import get_polisher_model  # noqa: E402
from src.talk_agent.state import SubgraphState  # noqa: E402
from src.tools.audio_tool.xfyun_tts.xfyun_tts_tool import (  # noqa: E402
    xfyun_tts_tool_by_text,
)

# 加载 backend/.env 中的环境变量。
load_dotenv(_BACKEND_DIR / ".env")

python_logger = logging.getLogger(__name__)

# SKILL.md 所在目录。
SKILL_PATH = (
    _BACKEND_DIR
    / "src"
    / "llm_models"
    / "prompts"
    / "skills"
    / "english_expression_polisher"
    / "SKILL.md"
)

# 初次测试时建议设为 False，避免触发 TTS 服务。
# 确认润色流程运行正常后，再改为 True。
ENABLE_TTS = True


def load_skill_content() -> str:
    """读取英语表达润色 Skill。"""

    if not SKILL_PATH.exists():
        raise FileNotFoundError(
            f"没有找到英语润色 Skill 文件：{SKILL_PATH}"
        )

    content = SKILL_PATH.read_text(encoding="utf-8").strip()

    if not content:
        raise ValueError(
            f"英语润色 Skill 文件内容为空：{SKILL_PATH}"
        )

    return content


# 在模块初始化时构建模型链，避免每次调用节点时重复构建。
polisher_chain = get_polisher_model()


def polisher_node(state: SubgraphState) -> dict:
    """执行英语表达润色，并按需调用 TTS。"""

    # 1. 获取用户原文
    raw_text = state.get("raw_text", "")
    user_input = state.get("user_input", "")
    original_text = raw_text or user_input

    if not isinstance(original_text, str):
        original_text = ""

    original_text = original_text.strip()

    # 2. 初始化打包输出（LangGraph 字段级整体替换，必须每次返回完整 7 字段）
    polisher_out = {
        "original_text": original_text,
        "polished_text": original_text,
        "explanation": "",
        "polish_comment": "",
        "polished_audio": b"",
        "polish_status": "fallback",
        "tts_status": "skipped",
    }
    logger = ["polisher_node: 开始执行"]

    # 3. 输入为空时跳过模型调用
    if not original_text:
        polisher_out["polish_status"] = "skipped"
        polisher_out["explanation"] = "没有检测到需要润色的英文内容。"
        polisher_out["polish_comment"] = polisher_out["explanation"]
        logger.append("polisher_node: 输入为空")
        return {"polisher": polisher_out, "logger": logger}

    # 4. 调用大模型进行润色
    try:
        result = polisher_chain.invoke(
            {
                "text": original_text,
                "skill_content": load_skill_content(),
            }
        )

        polished_text = result.polished_text.strip()
        explanation = result.explanation.strip()

        # 避免模型返回空结果
        if not polished_text:
            raise ValueError("模型返回的润色文本为空")

        polisher_out["polished_text"] = polished_text
        polisher_out["explanation"] = explanation
        polisher_out["polish_comment"] = explanation
        polisher_out["polish_status"] = "success"

        logger.append("polisher_node: 润色成功")

    except Exception:
        python_logger.exception("英语表达润色失败")

        # 失败时保留原文，避免中断整个训练流程
        polisher_out["polished_text"] = original_text
        polisher_out["explanation"] = (
            "润色服务暂时不可用，当前保留原始表达。"
        )
        polisher_out["polish_comment"] = polisher_out["explanation"]
        polisher_out["polish_status"] = "fallback"

        logger.append("polisher_node: 润色失败，已回退到原文")

    # 5. TTS 交给下游 tts_node 负责
    logger.append("polisher_node: 润色完成，交由 tts_node")
    return {"polisher": polisher_out, "logger": logger}


def tts_node(state: SubgraphState) -> dict:
    """独立节点：读取润色结果，按 enable_tts 开关合成语音。

    续杯模式：
    - polisher_node 已返回完整 7 字段 polisher 字典
    - 本节点读走 state["polisher"] 的完整内容
    - 只更新 polished_audio 和 tts_status 两个字段
    - 再把完整字典写回（LangGraph 字段级整体替换，不能只返回部分字段）
    """
    logger = ["tts_node: 开始执行"]

    # 1. 续杯：读上游已写入的完整 polisher 字典
    polisher = dict(state.get("polisher", {}))

    # 2. enable_tts 从顶层 state 读取（方案 C：控制开关不打包）
    enable_tts = state.get("enable_tts", False)

    if not enable_tts:
        polisher["tts_status"] = "skipped"
        logger.append("tts_node: enable_tts=False，跳过语音合成")
        return {"polisher": polisher, "logger": logger}

    # 3. 调用科大讯飞 TTS（普通函数，直接调用）
    polished_text = polisher.get("polished_text", "")

    if not polished_text:
        polisher["tts_status"] = "skipped"
        logger.append("tts_node: polished_text 为空，跳过语音合成")
        return {"polisher": polisher, "logger": logger}

    try:
        audio_bytes = xfyun_tts_tool_by_text(polished_text)

        if not isinstance(audio_bytes, bytes) or not audio_bytes:
            raise ValueError("TTS 未返回有效音频字节")

        polisher["polished_audio"] = audio_bytes
        polisher["tts_status"] = "success"
        logger.append("tts_node: 语音合成成功")

    except Exception:
        python_logger.exception("科大讯飞 TTS 调用失败")
        polisher["polished_audio"] = b""
        polisher["tts_status"] = "failed"
        logger.append("tts_node: 语音合成失败")

    return {"polisher": polisher, "logger": logger}


# 构建 LangGraph 子图。
builder = StateGraph(SubgraphState)

builder.add_node("polisher_node", polisher_node)
builder.add_node("tts_node", tts_node)

builder.add_edge(START, "polisher_node")
builder.add_edge("polisher_node", "tts_node")
builder.add_edge("tts_node", END)

polisher_subgraph = builder.compile()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)

    test_state = {
        "raw_text": (
            "Yesterday I went to a restaurant with my friend. "
            "The food was very delicious and we had a very good time. "
            "I think I will go there again in the future."
        ),
        "user_input": "",
        "enable_tts": True,
        "logger": [],
    }

    result = polisher_subgraph.invoke(test_state)

    print("\n========== 润色测试结果 ==========")
    print("用户原文：", test_state["raw_text"])
    polisher = result.get("polisher", {})
    print("润色结果：", polisher.get("polished_text", ""))
    print("修改说明：", polisher.get("explanation", ""))
    print("润色状态：", polisher.get("polish_status", ""))
    print("执行日志：", result.get("logger", []))

    if ENABLE_TTS:
        tts_status = polisher.get("tts_status", "")
        audio_bytes = polisher.get("polished_audio", b"")
        print("TTS 状态：", tts_status)
        print("音频字节数：", len(audio_bytes))
        if audio_bytes:
            output_dir = _BACKEND_DIR / "output" / "polisher_output"
            output_dir.mkdir(parents=True, exist_ok=True)
            audio_path = output_dir / "polished_audio.mp3"
            audio_path.write_bytes(audio_bytes)
            print("音频文件已保存：", audio_path)
