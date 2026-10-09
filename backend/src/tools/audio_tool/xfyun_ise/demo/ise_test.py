"""
Ise Client Usage Example
语音评测
"""
import os
import io
import base64
from xfyunsdkspeech.ise_client import IseClient
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

try:
    from dotenv import load_dotenv
except ImportError:
    raise RuntimeError(
        'Python environment is not completely set up: required package "python-dotenv" is missing.') from None

load_dotenv()


def stream(audio_data=None, answer_text="今天天气怎么样"):
    """语音评测：对一段音频按答案文本评分。

    audio_data  —— 评测音频：raw PCM 字节（16kHz/16bit/单声道），如 xfyun_iat_tool
                   返回的第二个值；传 None 时回退读本目录 resources 下的演示音频
    answer_text —— 评测答案文本（题目）
    返回完整评测 XML 结果字符串
    """
    try:
        # 初始化客户端
        client = IseClient(
            app_id=os.getenv('XF_APP_ID', ''),  # 替换为你的应用ID
            api_key=os.getenv('XF_API_KEY', ''),  # 替换为你的API密钥
            api_secret=os.getenv('XF_API_SECRET', ''),  # 替换为你的API密钥
            aue="raw",
            group="pupil",
            ent="cn_vip",
            category="read_sentence",
        )
        if audio_data is None:
            file_path = os.path.join(os.path.dirname(__file__), 'resources', 'read_sentence_cn.pcm')
            f = open(file_path, 'rb')
        else:
            f = io.BytesIO(audio_data)  # 内存音频包装成文件对象，与 IAT 录音格式一致，无需转码

        xml_result = ""
        for chunk in client.stream('\uFEFF' + answer_text, f):
            if chunk["data"]:
                result = str(base64.b64decode(chunk["data"]), 'utf-8')
                logger.info(f"返回结果: {result}")
                xml_result += result
            else:
                logger.info(f"返回结果: {chunk}")
        return xml_result
    except Exception as e:
        logger.error(f"评测失败: {str(e)}")
        raise


if __name__ == "__main__":
    # 可以选择运行非流式或流式生成
    stream()  # 流式生成
