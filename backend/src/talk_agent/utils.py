"""talk_agent 公共工具函数。

PR 评审意见落地：通用兜底逻辑（瞬态错误判定）提炼为公共函数，
供各节点 / 子图复用，避免每个模块各留一份同款副本。
"""


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
