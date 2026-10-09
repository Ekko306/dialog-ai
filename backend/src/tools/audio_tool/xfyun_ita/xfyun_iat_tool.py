"""
讯飞语音听写（IAT）工具封装
共用内核 _transcribe() 负责流式转录；三个入口按音频来源区分：
  xfyun_iat_tool_by_mic()         —— 麦克风实时录入，返回 (文本, 录音字节)
  xfyun_iat_tool_by_audio_data()  —— 内存音频字节（PCM），返回文本
  xfyun_iat_tool_by_audio_file()  —— 本地音频文件路径，返回文本
"""
import io
import os
import sys
import threading
from pathlib import Path

from xfyunsdkspeech.iat_client import IatClient
import logging

# 兼容直接运行本文件：把 backend 目录加入 sys.path，使 src.* 绝对导入可用；
# langgraph dev / uv run 下 backend 本就在 sys.path，无副作用
_BACKEND_DIR = Path(__file__).resolve().parents[4]  # xfyun_ita 比 subgraphs 更深，到 backend 是 4 层
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
    """创建讯飞听写客户端"""
    return IatClient(
        app_id=os.getenv('XF_APP_ID', ''),
        api_key=os.getenv('XF_API_KEY', ''),
        api_secret=os.getenv('XF_API_SECRET', ''),
        dwa="wpgs",  # 开启动态修正，最终定稿以 rst == 'rlt' 分块为准
    )


def _extract_words(chunk):
    """从单个流式分块中提取词列表"""
    words = []
    for ws in chunk.get('result', {}).get('ws', []):
        for cw in ws.get('cw', []):
            w = cw.get('w')
            if w:
                words.append(w)
    return words


# 输入：任意实现 read(size)->bytes 协议的音频源
# 输出：识别文本
def _transcribe(client, audio_source) -> str:
    """核心转录逻辑：把音频源流式喂给 SDK，收集定稿（rst=='rlt'）拼接成文本。

    audio_source 只需实现 read(size) -> bytes：
      - 文件对象 / io.BytesIO：读到末尾自然返回空字节，SDK 发送结束帧收尾
      - _MicSource：由 stop_event 控制停止
    三个公开入口共用本函数，入口只负责构造音频源和管理生命周期。
    """
    final_words = []
    for chunk in client.stream(audio_source):
        logger.info(f"返回结果: {chunk}")
        if chunk.get('result', {}).get('rst') == 'rlt':
            final_words.extend(_extract_words(chunk))
    return ''.join(final_words)


# 输入：本地ide录音机能力
# 输出：识别文本，语音字节流
def xfyun_iat_tool_by_mic():
    """入口 1：麦克风语音听写，按回车开始录入，再按回车结束。

    返回 (text, audio) 二元组：
      text  —— 完整识别文本
      audio —— 原始录音 PCM 字节流（16kHz/16bit/单声道，即 aue="raw" 格式），
               可直接作为 ISE 语音评测的音频入参传给 ise_test.stream()
    """
    client = _create_client()

    input("按回车开始语音录入...")
    p, mic_stream = open_mic()

    stop_event = threading.Event()
    source = MicSource(mic_stream, stop_event)
    result = {}

    # 转录放后台线程：SDK 在 source.read 阻塞等音频，主线程才能等待回车停止
    def run():
        result['text'] = _transcribe(client, source)

    thread = threading.Thread(target=run)
    thread.start()

    input("正在聆听，按回车结束语音录入...")
    stop_event.set()  # 下次 read 返回空字节，SDK 发送结束帧收尾
    thread.join(timeout=10)  # 等待服务端返回最终结果并正常关闭连接
    p.terminate()  # 会话结束后再释放麦克风

    return result['text'], b''.join(source.frames)


# 输入：内存中的音频字节（raw PCM 16kHz/16bit/单声道）
# 输出：识别文本
def xfyun_iat_tool_by_audio_data(audio_data) -> str:
    """入口 2：内存音频字节听写（如上游麦克风录音、前端上传的 PCM）"""
    client = _create_client()
    return _transcribe(client, io.BytesIO(audio_data))


# 输入：本地音频文件的电脑路径
# 输出：识别文本
def xfyun_iat_tool_by_audio_file(audio_file_path) -> str:
    """入口 3：本地音频文件听写（文件不存在时由 open 抛 FileNotFoundError）"""
    client = _create_client()
    with open(audio_file_path, 'rb') as f:
        return _transcribe(client, f)


if __name__ == "__main__":
    text, audio = xfyun_iat_tool_by_mic()
    print(f"识别文本: {text}")
    print(f"录音大小: {len(audio)} 字节")


    
    # Windows 路径必须用 r'' 原始字符串，否则 \x 会被当作十六进制转义符报 SyntaxError
    # text = xfyun_iat_tool_by_audio_file(r'D:\projects\syp\Develop\DialogAi\backend\src\tools\audio_tool\xfyun_ita\demo\resources\iat_pcm_16k.pcm')
    # print(text)