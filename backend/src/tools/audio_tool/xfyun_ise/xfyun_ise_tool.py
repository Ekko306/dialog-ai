"""
讯飞语音评测（ISE）工具封装
共用内核 _evaluate() 负责流式评测；三个入口按音频来源区分：
  xfyun_ise_tool_by_mic()         —— 麦克风实时录音并评测，返回 (评测XML, 录音字节)
  xfyun_ise_tool_by_audio_data()  —— 内存音频字节（PCM），返回评测XML
  xfyun_ise_tool_by_audio_file()  —— 本地音频文件路径，返回评测XML
"""
import base64
import io
import os
import sys
import threading
from pathlib import Path

from xfyunsdkspeech.ise_client import IseClient
import logging

# 兼容直接运行本文件：把 backend 目录加入 sys.path，使 src.* 绝对导入可用；
# langgraph dev / uv run 下 backend 本就在 sys.path，无副作用
_BACKEND_DIR = Path(__file__).resolve().parents[4]  # xfyun_ise 比 subgraphs 更深，到 backend 是 4 层
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from src.tools.audio_tool.mic import MicSource, open_mic  # noqa: E402

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

try:
    from dotenv import load_dotenv
except ImportError:
    raise RuntimeError(
        'Python environment is not completely set up: required package "python-dotenv" is missing.') from None

load_dotenv()


def _create_client():
    """创建讯飞评测客户端（read_sentence 句子朗读评测）"""
    return IseClient(
        app_id=os.getenv('XF_APP_ID', ''),
        api_key=os.getenv('XF_API_KEY', ''),
        api_secret=os.getenv('XF_API_SECRET', ''),
        aue="raw",
        group="pupil",
        ent="cn_vip",
        category="read_sentence",
    )


# 输入：答案文本 + 任意实现 read(size)->bytes 协议的音频源
# 输出：评测结果 XML
def _evaluate(client, answer_text, audio_source) -> str:
    """核心评测逻辑：把音频源流式喂给 SDK，拼接完整评测 XML 结果。

    audio_source 只需实现 read(size) -> bytes：
      - 文件对象 / io.BytesIO：读到末尾自然返回空字节，SDK 发送结束帧收尾
      - MicSource：由 stop_event 控制停止
    三个公开入口共用本函数，入口只负责构造音频源和管理生命周期。
    """
    xml_result = ""
    for chunk in client.stream('\uFEFF' + answer_text, audio_source):
        if chunk.get("data"):
            piece = str(base64.b64decode(chunk["data"]), 'utf-8')
            logger.info(f"返回结果: {piece}")
            xml_result += piece
        else:
            logger.info(f"返回结果: {chunk}")
    return xml_result


# 输入：本地ide录音机能力
# 输出：评测结果XML，语音字节流
def xfyun_ise_tool_by_mic(answer_text="今天天气怎么样"):
    """入口 1：麦克风录音并评测，按回车开始录入，再按回车结束。

    返回 (xml, audio) 二元组：
      xml   —— 完整评测结果 XML（解析 total_score 等分数）
      audio —— 原始录音 PCM 字节流（16kHz/16bit/单声道）
    """
    client = _create_client()

    input("按回车开始语音录入...")
    p, mic_stream = open_mic()

    stop_event = threading.Event()
    source = MicSource(mic_stream, stop_event)
    result = {}

    # 评测放后台线程：SDK 在 source.read 阻塞等音频，主线程才能等待回车停止
    def run():
        result['xml'] = _evaluate(client, answer_text, source)

    thread = threading.Thread(target=run)
    thread.start()

    input("正在聆听，按回车结束语音录入...")
    stop_event.set()  # 下次 read 返回空字节，SDK 发送结束帧收尾
    thread.join(timeout=10)  # 等待服务端返回最终结果并正常关闭连接
    p.terminate()  # 会话结束后再释放麦克风

    return result['xml'], b''.join(source.frames)


# 输入：内存中的音频字节（raw PCM 16kHz/16bit/单声道）
# 输出：评测结果XML
def xfyun_ise_tool_by_audio_data(audio_data, answer_text="今天天气怎么样") -> str:
    """入口 2：内存音频字节评测（如 IAT 麦克风录音返回的 audio、前端上传的 PCM）"""
    client = _create_client()
    return _evaluate(client, answer_text, io.BytesIO(audio_data))


# 输入：本地音频文件的电脑路径
# 输出：评测结果XML
def xfyun_ise_tool_by_audio_file(audio_file_path, answer_text="今天天气怎么样") -> str:
    """入口 3：本地音频文件评测（文件不存在时由 open 抛 FileNotFoundError）"""
    client = _create_client()
    with open(audio_file_path, 'rb') as f:
        return _evaluate(client, answer_text, f)


if __name__ == "__main__":
    # 演示：用 demo 自带的朗读音频评测
    # Windows 路径若手写必须用 r'' 原始字符串，否则 \x 会报 SyntaxError
    # demo_pcm = os.path.join(os.path.dirname(__file__), 'demo', 'resources', 'read_sentence_cn.pcm')
    # xml = xfyun_ise_tool_by_audio_file(demo_pcm, answer_text="今天天气怎么样")
    # print(xml)


    xml, audio = xfyun_ise_tool_by_mic(answer_text="今天天气怎么样")  # 注意解包二元组
    print(f"\n===== 评测结果 XML =====\n{xml}")
    print(f"===== 录音大小: {len(audio)} 字节 =====")
