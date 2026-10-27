"""口语教练模型工厂（组装层）。

按 LangChain 官方规范（LCEL）组装：ChatPromptTemplate | model 组合链。
- system prompt 在链首，节点侧不感知 prompt 细节
- role/scenario 在工厂期 partial 固化，节点调用时只传 messages
- 换基座模型传 base_model 参数即可（如 GLM），模板内容改 prompts.py
"""

from pathlib import Path

from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.runnables import Runnable
from langgraph.constants import TAG_NOSTREAM  # nostream 标签：把内部 LLM 调用排除出 messages 流

from src.llm_models.prompts.coach_prompt import get_coach_template
from src.llm_models.prompts.check_prompt import GRAMMAR_CHECK_PROMPT
from src.talk_agent.subgraphs.grammar_check_subgraph.check_conatants import (  # noqa: E402
    GrammarIssue,  # noqa: F401  re-export：保持原导入路径可用
    GrammarVerdict,
)

from src.llm_models.prompts.skills.english_expression_polisher.polisher_schema import PolishResult

def get_model(prompt: ChatPromptTemplate, base_model: Runnable | None = None) -> Runnable:
    """返回「system prompt + 对话历史」组装好的教练链。

    role/scenario 来自 state 的 context 快照（父图 store_resolve_node hydrate）。
    用法：coach.invoke({"messages": state["messages"]})
    """
    if base_model is None:
        # 惰性导入默认基座：导入本模块不再强依赖 DeepSeek 配置
        from src.llm_models.deepseek_model import model as deepseek_model
        base_model = deepseek_model

    return prompt | base_model


NEW_COACH_DIALOG_START = "Please give me a topic to start!"
def get_coach_model(role: str, scenario: str) -> Runnable:

    coach_prompt = ChatPromptTemplate.from_messages([
        ("system", get_coach_template(scenario)),
        # 对话历史占位：传入的 messages 整体插入 system 之后
        MessagesPlaceholder("messages"),
    ])
    # partial 把本次运行的 role/scenario 固化进模板，调用方无需再传
    coach_prompt = coach_prompt.partial(role=role, scenario=scenario)

    return get_model(coach_prompt)

def get_checker_model(base_model: Runnable | None = None) -> Runnable:
    """语法检查链：ChatPromptTemplate | 基座模型（结构化输出 + nostream）。

    - prompt 走模板组装（系统规则 + 单条待检文本），调用方只传 {"raw_text": ...}，
      不再手拼 [SystemMessage, HumanMessage] 消息列表
    - 基座默认团队统一的 deepseek_model（惰性导入，与 get_coach_model 同款，
      导入本模块不强依赖 DeepSeek 配置）；换基座传 base_model 参数即可
    - with_structured_output(GrammarVerdict)：强制按 Schema 返回
    - TAG_NOSTREAM：结构化输出底层是 function calling，其 tool_call chunks 若流入
      stream_mode="messages" 会在前端渲染成幽灵 "Used Tool" 消息且跨轮合并，必须排除
    """
    checker_prompt = ChatPromptTemplate.from_messages(
        [
            ("system", GRAMMAR_CHECK_PROMPT),
            ("human", "{raw_text}"),
        ]
    )
    if base_model is None:
        # 惰性导入默认基座：导入本模块不再强依赖 DeepSeek 配置
        from src.llm_models.deepseek_model import model as deepseek_model

        base_model = deepseek_model
    return get_model(
        checker_prompt,
        base_model.with_structured_output(GrammarVerdict).with_config(tags=[TAG_NOSTREAM]),
    )

# ==================== 英语表达润色模型 ====================

# Skill 规则文件：与 polisher_schema 同目录，工厂期一次性加载并 partial 固化。
_POLISHER_SKILL_PATH = (
    Path(__file__).parent
    / "prompts"
    / "skills"
    / "english_expression_polisher"
    / "SKILL.md"
)


def _load_polisher_skill() -> str:
    """加载润色 Skill 规则文件内容。"""

    if not _POLISHER_SKILL_PATH.is_file():
        raise FileNotFoundError(f"没有找到英语润色 Skill：{_POLISHER_SKILL_PATH}")

    content = _POLISHER_SKILL_PATH.read_text(encoding="utf-8").strip()

    if not content:
        raise ValueError("英语润色 Skill 内容为空")

    return content


def get_polisher_model(
    base_model: Runnable | None = None,
) -> Runnable:
    """
    构建英语表达润色模型链。

    与 get_coach_model 同一模式：本地写好模板，工厂期 partial 固化运行期常量
    （skill_content），调用方只传业务输入（text）。

    输入：
        text: 用户原始英文。

    输出：
        PolishResult 结构化对象。
    """

    polisher_prompt = ChatPromptTemplate.from_messages(
        [
            (
                "system",
                """
你是一个英语口语表达润色助手。

请严格遵循下面的 Skill 规则：

{skill_content}

请根据 Skill 中的规则处理用户输入的英文。

核心要求：
1. 保留用户的原始意思，不得擅自增加或删除重要信息。
2. 重点改善口语表达的自然度、流畅度和地道程度。
3. 采用最小必要修改，不要为了修改而修改。
4. 不要把日常口语改成过于正式的书面英语。
5. 如果原文语法正确，不要虚构语法错误。
6. 使用简体中文解释实际修改及其原因。
7. 原文已经自然时，可以保留原文，并说明无需修改。

请按照指定的结构化输出格式返回结果。
""",
            ),
            (
                "human",
                "请润色下面这段英语口语：\n\n{text}",
            ),
        ]
    )

    # partial 固化 Skill 规则，调用方无需再传 skill_content。
    polisher_prompt = polisher_prompt.partial(skill_content=_load_polisher_skill())

    if base_model is None:
        from src.llm_models.deepseek_model import model as deepseek_model

        base_model = deepseek_model

    # 要求模型按照 PolishResult 的字段结构返回结果。
    # TAG_NOSTREAM：结构化输出底层是 function calling，其 tool_call chunks 若流入
    # stream_mode="messages" 会在前端渲染成幽灵 "Used Tool" 消息且跨轮合并，必须排除
    # （与 get_checker_model 同款，在工厂内固化，调用方无需重复配置）
    structured_model = base_model.with_structured_output(PolishResult).with_config(
        tags=[TAG_NOSTREAM]
    )

    # 复用已有的模型链构建函数。
    return get_model(
        prompt=polisher_prompt,
        base_model=structured_model,
    )