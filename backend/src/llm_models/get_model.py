"""口语教练模型工厂（组装层）。

按 LangChain 官方规范（LCEL）组装：ChatPromptTemplate | model 组合链。
- system prompt 在链首，节点侧不感知 prompt 细节
- role/scenario 在工厂期 partial 固化，节点调用时只传 messages
- 换基座模型传 base_model 参数即可（如 GLM），模板内容改 prompts.py
"""

from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.runnables import Runnable

from src.llm_models.prompts.coach_prompt import get_coach_template


def get_model(prompt: ChatPromptTemplate, base_model: Runnable | None = None) -> Runnable:
    """返回「system prompt + 对话历史」组装好的教练链。

    role/scenario 来自 state 的 context 快照（父图 store_resolve_node hydrate）。
    用法：coach.invoke({"messages": state["messages"]})
    """
    if base_model is None:
        # 惰性导入默认基座：导入本模块不再强依赖 DeepSeek 配置
        from src.llm_models.deepseek_model import model as deepseek_model
        base_model = deepseek_model

    # partial 把本次运行的 role/scenario 固化进模板，调用方无需再传
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
