"""talk_agent 公共工具函数。

PR 评审意见落地：通用兜底逻辑（瞬态错误判定）提炼为公共函数，
供各节点 / 子图复用，避免每个模块各留一份同款副本。
"""

from pathlib import Path


def validate_audio_file(path: str) -> str | None:
    """音频文件前置校验（#2 工具调用稳定性：参数前置校验）。

    在发起讯飞网络调用前拦截无效文件，避免白费一次 API 往返：
    - 文件不存在 / 0 字节 / 后缀不合法 → 返回具体错误原因
    - 通过 → 返回 None
    """
    p = Path(path)
    if not p.is_file():
        return "文件不存在"
    if p.stat().st_size == 0:
        return "文件为空（0 字节）"
    if p.suffix.lower() not in {".pcm", ".wav", ".mp3", ".m4a", ".aac"}:
        return f"不支持的音频格式：{p.suffix}"
    return None


def is_transient(e: Exception) -> bool:
    """瞬态错误判定：连接失败、超时、服务端 5xx 可重试。

    RetryPolicy 挂载与节点内降级判断共用这一份：
    - 重试：连接失败、超时、5xx（duck-typing 读 status_code，
      兼容 openai/httpx 异常，无需导入具体类型）
    - 不重试：401 认证失败、400 参数错误等客户端错误（重试也不会好）
    """
    if isinstance(e, (ConnectionError, TimeoutError)):
        return True
    status = getattr(e, "status_code", None)
    return isinstance(status, int) and status >= 500
