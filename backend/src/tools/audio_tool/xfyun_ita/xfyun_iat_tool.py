"""
讯飞语音听写（IAT）工具封装
麦克风实时录入：按回车开始，再按回车结束，返回完整识别文本
"""
import os
import threading

import pyaudio
from xfyunsdkspeech.iat_client import IatClient
import logging

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


def _open_mic():
    """打开 16kHz 单声道麦克风输入流，返回 (PyAudio 实例, 麦克风流)"""
    p = pyaudio.PyAudio()
    mic_stream = p.open(
        format=pyaudio.paInt16,
        channels=1,
        rate=16000,
        input=True,
        frames_per_buffer=1280,
    )
    return p, mic_stream


def _extract_words(chunk):
    """从单个流式分块中提取词列表"""
    words = []
    for ws in chunk.get('result', {}).get('ws', []):
        for cw in ws.get('cw', []):
            w = cw.get('w')
            if w:
                words.append(w)
    return words


class _MicSource:
    """麦克风音频源包装：stop_event 置位后 read 返回空字节，
    触发 SDK 发送结束帧（status=2），服务端才能正常收尾并关闭连接"""

    def __init__(self, stream, stop_event):
        self._stream = stream
        self._stop = stop_event

    def read(self, size):
        if self._stop.is_set():
            return b''
        try:
            return self._stream.read(size, exception_on_overflow=False)
        except (OSError, IOError):
            return b''  # 麦克风异常中断时也按正常结束处理，避免 SDK 报错


def xfyun_iat_tool():
    """麦克风语音听写：按回车开始录入，再按回车结束，返回完整识别文本"""
    client = _create_client()

    input("按回车开始语音录入...")
    p, mic_stream = _open_mic()

    # 收集最终定稿文本（rst == 'rlt' 的分块），过程草稿（pgs）忽略
    final_words = []
    stop_event = threading.Event()

    def run():
        for chunk in client.stream(_MicSource(mic_stream, stop_event)):
            logger.info(f"返回结果: {chunk}")
            if chunk.get('result', {}).get('rst') == 'rlt':
                final_words.extend(_extract_words(chunk))

    thread = threading.Thread(target=run)
    thread.start()

    input("正在聆听，按回车结束语音录入...")
    stop_event.set()  # 下次 read 返回空字节，SDK 发送结束帧收尾
    thread.join(timeout=10)  # 等待服务端返回最终结果并正常关闭连接
    p.terminate()  # 会话结束后再释放麦克风

    return ''.join(final_words)


if __name__ == "__main__":
    res = xfyun_iat_tool()
    print(res)