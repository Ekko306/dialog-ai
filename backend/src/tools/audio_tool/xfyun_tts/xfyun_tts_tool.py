"""
讯飞在线语音合成（TTS）工具封装：把正确文本转成英语语音，供 tutor 反馈播放。

- 密钥复用 IAT/ISE 同一套 XF_APP_ID / XF_API_KEY / XF_API_SECRET
- 输出 MP3（aue=lame），保存后可直接用系统播放器打开
- 美式发音要求：vcn 默认 vixy（Catherine，美式口音英文女声）；勿改用 xiaoyan（中文发音人）。
  发音为 TTS 引擎词典标准音（与音标一致），重音自动处理，不支持 IPA 注入。
  若账号未开通该发音人报错，可用环境变量 TTS_VCN 切换其他英文发音人
"""
import base64
import os
import sys
from pathlib import Path

# 兼容直接运行本文件：把 backend 目录加入 sys.path，使 src.* 绝对导入可用
_BACKEND_DIR = Path(__file__).resolve().parents[4]
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(override=True)


def xfyun_tts_tool_by_text(text: str, speed: int = 45) -> bytes:
    """文本 → 英语语音（MP3 字节）。speed 取值 0~100，默认 45 略慢便于跟读。

    失败时抛异常，由调用方决定降级策略（如跳过播放只给文本）。
    """
    from xfyunsdkspeech.tts_client import TtsClient

    client = TtsClient(
        app_id=os.getenv("XF_APP_ID", ""),
        api_key=os.getenv("XF_API_KEY", ""),
        api_secret=os.getenv("XF_API_SECRET", ""),
        vcn=os.getenv("TTS_VCN", "vixy"),
        aue="lame",  # 输出 MP3
        sfl=1,
        speed=speed,
        tte="UTF8",
    )
    audio = bytearray()
    for chunk in client.stream(text):
        b64 = chunk.get("audio") if isinstance(chunk, dict) else chunk
        if b64:
            audio.extend(base64.b64decode(b64))
    return bytes(audio)


if __name__ == "__main__":
    import tempfile
    import uuid

    demo_text = "She goes to school every day."
    print(f"合成中: {demo_text}")
    mp3 = xfyun_tts_tool_by_text(demo_text)
    out = Path(tempfile.gettempdir()) / f"tutor_tts_{uuid.uuid4().hex[:8]}.mp3"
    out.write_bytes(mp3)
    print(f"已保存: {out}（{len(mp3)} 字节），即将用系统默认播放器播放")
    os.startfile(str(out))  # Windows 下自动唤起默认播放器
    # SDK 的 websocket 线程在收完音频后不会主动关闭，会滞留几十秒直到服务器超时断开，
    # 并打印 "server read msg timeout" 的 ERROR 噪音；音频在此前已完整接收，
    # CLI 演示直接强制退出避免假死观感（播放器是独立进程，不受影响）
    os._exit(0)
