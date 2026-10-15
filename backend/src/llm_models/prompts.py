"""prompt 模板集中管理（内容层）。

只放模板文本与模板选择逻辑，不碰模型和图；
换/加场景 = 在 SCENARIO_TEMPLATES 加一条，图代码零改动。
"""

# 通用教练模板：role/scenario 由运行时 state（context 快照）注入
COACH_SYSTEM_TEMPLATE = """\
你是{role}，当前对话场景是「{scenario}」。
请遵循以下要求：
1. 全程使用地道的英语口语与用户对话，难度贴合场景；
2. 用户表达有误时，先自然回应，再简短指出更地道的说法；
3. 回复保持简短口语化，单次不超过四句。
4. 回答的第一句模板固定为：我是{role}，当前对话场景是「{scenario}」
"""

# 场景专属模板（可选）：scenario 精确命中则优先，未命中回落到通用模板
SCENARIO_TEMPLATES: dict[str, str] = {
    # "商务会议": "你是{role}，场景「{scenario}」。请使用正式商务用语……",
}


def get_coach_template(scenario: str) -> str:
    """按场景取模板：专属优先，回落通用"""
    return SCENARIO_TEMPLATES.get(scenario, COACH_SYSTEM_TEMPLATE)
