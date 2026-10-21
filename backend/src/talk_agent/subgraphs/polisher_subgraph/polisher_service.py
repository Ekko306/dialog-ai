
"""英语表达润色业务逻辑。"""

import logging
from pathlib import Path

from dotenv import load_dotenv

# backend 目录：backend/src/talk_agent/subgraphs/polisher_subgraph/polisher_service.py
_BACKEND_DIR = Path(__file__).resolve().parents[4]

# 先加载 backend/.env：本模块在导入时会构建模型链，密钥必须先就绪。
load_dotenv(_BACKEND_DIR / ".env", override=True)

from src.llm_models.get_model import get_polisher_model  # noqa: E402


python_logger = logging.getLogger(__name__)

SKILL_PATH = (
    _BACKEND_DIR
    / "src"
    / "llm_models"
    / "prompts"
    / "skills"
    / "english_expression_polisher"
    / "SKILL.md"
)

MAX_POLISH_ATTEMPTS = 2

# 模块加载时构建一次模型链，避免每次调用重复构建。
polisher_chain = get_polisher_model()


def load_skill_content() -> str:
    """加载润色规则文件。"""

    if not SKILL_PATH.is_file():
        raise FileNotFoundError(
            f"没有找到英语润色 Skill：{SKILL_PATH}"
        )

    content = SKILL_PATH.read_text(encoding="utf-8").strip()

    if not content:
        raise ValueError("英语润色 Skill 内容为空")

    return content


def polish_text(text: str) -> dict:
    """调用模型润色文本，并返回经过基础校验的结果。

    Raises:
        ValueError: 模型输出缺少必要内容。
        Exception: 所有模型调用尝试均失败时抛出最后一次异常。
    """

    if not isinstance(text, str) or not text.strip():
        raise ValueError("输入文本不能为空")

    skill_content = load_skill_content()
    last_error = None

    for attempt in range(MAX_POLISH_ATTEMPTS):
        try:
            result = polisher_chain.invoke({
                "text": text,
                "skill_content": skill_content,
            })

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

            # 基础校验通过，返回业务结果。
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
