
"""英语润色结果的语音合成业务逻辑。"""

import logging

# 先显式导入 SDK 触发其 Logger 单例初始化：
# 工具把 SDK 导入延迟在函数内部，若不先导入，
# 下面的级别设置会在首次 TTS 调用时被 SDK 单例的 setLevel(ERROR) 覆盖。
import xfyunsdkspeech.tts_client  # noqa: F401

# 讯飞 SDK 收完音频后 websocket 线程关闭时会打印无意义的
# "server read msg timeout" ERROR，属已知噪音而非故障，直接屏蔽。
_xf_logger = logging.getLogger("XfyunPythonSDK")
_xf_logger.setLevel(logging.CRITICAL)
for _xf_handler in _xf_logger.handlers:
    _xf_handler.setLevel(logging.CRITICAL)
logging.getLogger("websocket").setLevel(logging.CRITICAL)

from src.tools.audio_tool.xfyun_tts.xfyun_tts_tool import (
    xfyun_tts_tool_by_text,
)


def synthesize_speech(text: str) -> bytes:
    """调用科大讯飞 TTS，返回音频字节。"""

    if not isinstance(text, str) or not text.strip():
        raise ValueError("TTS 输入文本不能为空")

    # 沿用项目当前的直接调用方式。
    audio_bytes = xfyun_tts_tool_by_text(text.strip())

    if not isinstance(audio_bytes, bytes) or not audio_bytes:
        raise ValueError(
            "科大讯飞 TTS 没有返回有效的音频字节"
        )

    return audio_bytes
