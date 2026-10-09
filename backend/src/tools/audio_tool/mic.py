"""
麦克风采集公共设施：open_mic + MicSource
供 IAT（听写）、ISE（评测）等音频工具复用
"""
import threading

import pyaudio


def open_mic():
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


class MicSource:
    """麦克风音频源包装：stop_event 置位后 read 返回空字节，
    触发 SDK 发送结束帧（status=2），服务端才能正常收尾并关闭连接。
    同时收集所有读取到的原始 PCM 字节块，供评测（ISE）复用。"""

    def __init__(self, stream, stop_event: threading.Event):
        self._stream = stream
        self._stop = stop_event
        self.frames = []  # 收集已读取的原始 PCM 字节块

    def read(self, size):
        if self._stop.is_set():
            return b''
        try:
            data = self._stream.read(size, exception_on_overflow=False)
        except (OSError, IOError):
            return b''  # 麦克风异常中断时也按正常结束处理，避免 SDK 报错
        if data:
            self.frames.append(data)
        return data
