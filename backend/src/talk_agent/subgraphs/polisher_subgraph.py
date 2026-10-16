
import sys
import logging
from pathlib import Path

# 兼容直接运行本文件
# 定位 backend 目录：E:\dialog-ai-main\backend
_BACKEND_DIR = Path(__file__).resolve().parents[3]

# 将 backend 目录加入 Python 模块搜索路径
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

# 定位项目根目录：E:\dialog-ai-main
_PROJECT_DIR = _BACKEND_DIR.parent

# 英语表达润色 Skill 文件路径
SKILL_PATH = (
    _PROJECT_DIR
    / ".trae"
    / "skills"
    / "english-expression-polisher"
    / "SKILL.md"
)


def load_skill_content() -> str:
    """读取英语表达润色 Skill 的规则。"""
    if not SKILL_PATH.is_file():
        raise FileNotFoundError(
            f"未找到英语润色 Skill 文件：{SKILL_PATH}"
        )

    return SKILL_PATH.read_text(encoding="utf-8")


from langgraph.graph import StateGraph, START, END  # noqa: E402
from langchain_deepseek import ChatDeepSeek  # noqa: E402
from langchain_core.prompts import ChatPromptTemplate  # noqa: E402
from pydantic import BaseModel, Field  # noqa: E402

from src.talk_agent.state import SubgraphState  # noqa: E402
from src.tools.audio_tool.xfyun_tts.xfyun_tts_tool import xfyun_tts_tool_by_text  # noqa: E402

try:
    from dotenv import load_dotenv
except ImportError:
    raise RuntimeError(
        'Python environment is not completely set up: '
        'required package "python-dotenv" is missing.'
    ) from None

load_dotenv()

# 使用标准库记录日志
python_logger = logging.getLogger(__name__)


# 1. 初始化大模型
llm = ChatDeepSeek(
    model="deepseek-chat",
    temperature=0.2,
    timeout=15,
    max_retries=2,
)


# 2. 定义结构化输出
class PolishResult(BaseModel):
    original_text: str = Field(
        ...,
        description="用户的原始英文，必须保持原样，不得改写",
    )
    polished_text: str = Field(
        ...,
        description=(
            "润色后的英文，重点改善表达的流畅度、自然度、"
            "习惯搭配、简洁性和语境适配度，同时保留原意"
        ),
    )
    explanation: str = Field(
        ...,
        description="简体中文修改说明，解释实际修改及其原因",
    )


# 3. 定义英语表达润色提示词
polisher_prompt = ChatPromptTemplate.from_messages([
    (
        "system",
        """
你是英语表达润色助手。

请将以下 Skill 规则作为本次任务的行为规范：

<skill_instructions>
{skill_content}
</skill_instructions>

请严格遵循这些规则完成英语表达润色。

要求：
1. 保留用户原文的实际内容，不要改写原文字段。
2. 只进行有明确价值的表达优化，不要为了修改而修改。
3. 使用简体中文解释实际发生的修改及其原因。
4. 不要进行独立的语法检查或语法错误诊断。
5. 返回结果必须符合系统指定的结构化输出字段。
"""
    ),
    (
        "human",
        "请润色以下英语表达，保留原意：\n{text}"
    ),
])


# 4. 构建模型处理链
polisher_chain = (
    polisher_prompt
    | llm.with_structured_output(PolishResult)
)


# 5. 定义润色节点的语音合成辅助：润色结果 → 讯飞 TTS → MP3 字节
def synthesize_polish_audio(polished_text: str) -> bytes:
    """把润色结果合成为美式发音 MP3 字节（存入 state.polished_audio）。

    - 输入为空 → 返回 b""（不调 TTS）
    - TTS 调用失败或返回空字节 → 降级返回 b""，不中断润色主流程
    - 成功 → 返回 MP3 字节（与 grammer_tutor 的 tutor_audio 同款模式）
    """
    if not polished_text or not polished_text.strip():
        return b""

    try:
        audio_bytes = xfyun_tts_tool_by_text(polished_text)
    except Exception:
        python_logger.exception("polisher_node TTS 调用失败")
        return b""

    return audio_bytes or b""


def polisher_node(state: SubgraphState) -> SubgraphState:
    raw_text = state.get("raw_text", "")

    # 5.1 空输入处理：无需调用模型，也无需读取 Skill
    if not raw_text or not raw_text.strip():
        return {
            "original_text": raw_text,
            "polished_text": "",
            "explanation": "",
            "polish_comment": "",
            "polished_audio": b"",
            "logger": ["polisher_node: 输入为空，跳过润色"],
        }

    # 5.2 读取 Skill 并调用模型
    try:
        skill_content = load_skill_content()

        result: PolishResult = polisher_chain.invoke({
            "text": raw_text,
            "skill_content": skill_content,
        })

        # 获取模型返回的润色结果和修改说明
        polished_text = (result.polished_text or "").strip()
        explanation = (result.explanation or "").strip()

        # 如果模型返回空润色结果，则保留原文
        if not polished_text:
            polished_text = raw_text
            explanation = (
                "本次未能生成有效润色结果，已保留原文，请稍后重试。"
            )
            log_msg = (
                "polisher_node: 模型返回为空，已降级返回原句"
            )
        else:
            log_msg = "polisher_node: 执行完毕"

    except Exception:
        python_logger.exception("polisher_node 调用失败")

        # 模型或 Skill 读取失败时，返回原文，避免流程中断
        polished_text = raw_text
        explanation = (
            "润色服务暂时不可用，本次已保留原文，请稍后重试。"
        )
        log_msg = (
            "polisher_node: 调用失败，已降级返回原句"
        )

    # 5.3 润色结果合成语音（TTS 失败或跳过都不中断主流程，仅记录日志）
    polished_audio = synthesize_polish_audio(polished_text)
    if polished_audio:
        log_msg = f"{log_msg}；TTS 音频已生成（{len(polished_audio)} 字节）"
    else:
        log_msg = f"{log_msg}；TTS 音频未生成（空文本跳过或调用失败）"

    # 5.4 写入状态，保留原文、润色结果、修改说明和语音
    return {
        "original_text": raw_text,
        "polished_text": polished_text,
        "explanation": explanation,
        # 兼容项目原有读取 polish_comment 的模块
        "polish_comment": explanation,
        "polished_audio": polished_audio,
        "logger": [log_msg],
    }


# 6. 构建润色子图
builder = StateGraph(state_schema=SubgraphState)

builder.add_node("polisher_node", polisher_node)
builder.add_edge(START, "polisher_node")
builder.add_edge("polisher_node", END)

polisher_subgraph = builder.compile()


# 7. 独立测试
if __name__ == "__main__":
    test_text = (
        "Yesterday I went to a restaurant with my friend. "
        "The food was very delicious and we had a very good time. "
        "I think I will go there again in the future."
    )

    res = polisher_subgraph.invoke({
        "raw_text": test_text,
        "logger": [],
    })

    print("用户原文：", res.get("original_text", ""))
    print("润色结果：", res.get("polished_text", ""))
    print("修改说明：", res.get("explanation", ""))
    print("执行日志：", res.get("logger", []))

    # 语音输出验证：state.polished_audio 字节 → MP3 落盘 → 头校验 → 自动播放
    import os
    import tempfile
    import uuid

    audio_bytes = res.get("polished_audio") or b""
    if audio_bytes:
        out = Path(tempfile.gettempdir()) / f"polished_tts_{uuid.uuid4().hex[:8]}.mp3"
        out.write_bytes(audio_bytes)
        head_ok = audio_bytes[:3] == b"ID3" or audio_bytes[:2] in (
            b"\xff\xfb", b"\xff\xf3",
        )
        print(
            f"语音文件：{out}"
            f"（{len(audio_bytes)} 字节，MP3 头校验：{'通过' if head_ok else '未识别'}）"
        )
        os.startfile(str(out))  # Windows 下自动唤起默认播放器
        # 同 xfyun_tts_tool：SDK websocket 线程收完音频后滞留至服务器超时才断开，
        # CLI 演示直接强制退出避免假死观感（播放器是独立进程，不受影响）
        os._exit(0)
    else:
        print("语音文件：未生成（TTS 跳过或失败，请看上方日志）")
