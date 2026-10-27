
"""英语表达润色业务逻辑。"""

import logging
import re
from pathlib import Path

from dotenv import load_dotenv

# backend 目录：backend/src/talk_agent/subgraphs/polisher_subgraph/polisher_service.py
_BACKEND_DIR = Path(__file__).resolve().parents[4]

# 先加载 backend/.env：本模块在导入时会构建模型链，密钥必须先就绪。
load_dotenv(_BACKEND_DIR / ".env", override=True)

from src.llm_models.get_model import get_polisher_model  # noqa: E402


python_logger = logging.getLogger(__name__)

MAX_POLISH_ATTEMPTS = 2

# 模块加载时构建一次模型链，避免每次调用重复构建。
# TAG_NOSTREAM 已在模型工厂 get_polisher_model 内固化，调用方无需重复配置。
polisher_chain = get_polisher_model()


def polish_text(text: str) -> dict:
    """调用模型润色文本，并返回经过基础校验的结果。

    Raises:
        ValueError: 模型输出缺少必要内容。
        Exception: 所有模型调用尝试均失败时抛出最后一次异常。
    """

    if not isinstance(text, str) or not text.strip():
        raise ValueError("输入文本不能为空")

    last_error = None

    for attempt in range(MAX_POLISH_ATTEMPTS):
        try:
            # skill_content 已由模型工厂 partial 固化，这里只传业务输入。
            result = polisher_chain.invoke({"text": text})

            # 兼容 Pydantic 模型和字典。
            if isinstance(result, dict):
                polished_text = result.get("polished_text", "")
                explanation = result.get("explanation", "")
            else:
                polished_text = getattr(result, "polished_text", "")
                explanation = getattr(result, "explanation", "")

            if not isinstance(polished_text, str):
                raise ValueError("polished_text 必须是字符串")

            if not isinstance(explanation, str):
                raise ValueError("explanation 必须是字符串")

            polished_text = polished_text.strip()
            explanation = explanation.strip()

            if not polished_text:
                raise ValueError("模型返回的润色文本为空")

            if not explanation:
                raise ValueError("模型返回的中文解释为空")

            # ---- 轻量自我校验（确定性规则，不额外调 LLM）----
            original_len = len(text)
            polished_len = len(polished_text)

            # 规则 1：长度异常——润色结果不能比原文短 50%（丢核心内容）或长 300%（加无关内容）
            if polished_len < original_len * 0.5:
                raise ValueError(
                    f"润色结果过短，可能丢失核心内容"
                    f"（原文 {original_len} 字符，润色后 {polished_len} 字符）"
                )
            if polished_len > original_len * 3:
                raise ValueError(
                    f"润色结果过长，可能引入无关内容"
                    f"（原文 {original_len} 字符，润色后 {polished_len} 字符）"
                )

            # 规则 2：无有效英文字母——模型可能输出了全标点、全中文或乱码
            english_letters = re.findall(r"[a-zA-Z]", polished_text)
            if len(english_letters) < 3:
                raise ValueError(
                    f"润色结果英文字母过少，可能是无效输出"
                    f"：{polished_text[:50]!r}"
                )

            # 规则 3：非英文混入过多中文——polished_text 应主要是英文
            chinese_chars = re.findall(r"[\u4e00-\u9fff]", polished_text)
            if chinese_chars and len(chinese_chars) > len(english_letters) * 0.2:
                raise ValueError(
                    f"润色结果混入过多中文字符，可能是格式化错误"
                )

            # 基础校验 + 自我校验均通过，返回业务结果。
            return {
                "polished_text": polished_text,
                "explanation": explanation,
            }

        except Exception as exc:
            last_error = exc
            python_logger.warning(
                "润色调用第 %d/%d 次失败：%s",
                attempt + 1,
                MAX_POLISH_ATTEMPTS,
                exc,
                exc_info=True,
            )

    # 所有尝试均失败，由节点层执行回退。
    raise last_error
