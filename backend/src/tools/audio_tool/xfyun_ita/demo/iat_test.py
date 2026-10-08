"""
Iat Client Usage Example
语音听写
"""
import os
from xfyunsdkspeech.iat_client import IatClient
import logging
import time
import pyaudio
import threading

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

try:
    from dotenv import load_dotenv
except ImportError:
    raise RuntimeError(
        'Python environment is not completely set up: required package "python-dotenv" is missing.') from None

load_dotenv()


def extract_words(chunk):
    """从单个分块结果中提取所有词(w)，拼接成该块对应的文本片段"""
    words = []
    for ws in chunk.get('result', {}).get('ws', []):
        for cw in ws.get('cw', []):
            w = cw.get('w')
            if w:
                words.append(w)
    return words


def stream():
    """非流式生成音频示例"""
    try:
        # 初始化客户端
        client = IatClient(
            app_id=os.getenv('XF_APP_ID', ''),  # 替换为你的应用ID
            api_key=os.getenv('XF_API_KEY', ''),  # 替换为你的API密钥
            api_secret=os.getenv('XF_API_SECRET', ''),  # 替换为你的API密钥
            dwa="wpgs"
        )
        file_path = os.path.join(os.path.dirname(__file__), 'resources', 'iat_pcm_16k.pcm')
        f = open(file_path, 'rb')

        # 收集最终定稿文本（rst == 'rlt' 的分块，'pgs' 为过程草稿忽略）
        final_words = []
        for chunk in client.stream(f):
            logger.info(f"返回结果: {chunk}")
            if chunk.get('result', {}).get('rst') == 'rlt':
                final_words.extend(extract_words(chunk))

        # 所有流式结果输出完毕后，输出完整结果
        print(f"\n完整听写结果: {''.join(final_words)}")

    except Exception as e:
        logger.error(f"生成音频失败: {str(e)}")
        raise


def microphone_stream():
    """非流式生成音频示例"""
    try:
        # 初始化客户端
        client = IatClient(
            app_id=os.getenv('APP_ID', ''),  # 替换为你的应用ID
            api_key=os.getenv('API_KEY', ' '),  # 替换为你的API密钥
            api_secret=os.getenv('API_SECRET', ''),  # 替换为你的API密钥
            dwa="wpgs"
        )

        time.sleep(1)
        input("按回车开始实时转写...")

        p = pyaudio.PyAudio()
        mic_stream = p.open(format=pyaudio.paInt16,
                            channels=1,
                            rate=16000,
                            input=True,
                            frames_per_buffer=1280)

        def run():
            for chunk in client.stream(mic_stream):
                logger.info(f"返回结果: {chunk}")

        thread = threading.Thread(target=run)
        thread.start()

        time.sleep(2)
        input("正在聆听，按回车结束转写...\r\n")
        p.terminate()
    except Exception as e:
        logger.error(f"生成音频失败: {str(e)}")
        raise


if __name__ == "__main__":
    # 可以选择运行非流式或流式生成
    stream()  # 流式生成
    # microphone_stream()  # 麦克风采集
