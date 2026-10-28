"""polisher_reply_message_node 契约测试（005-polisher-bubble，无需 API key）。

覆盖 T003：polisher_data 透传挂载（contract §1）——
- success 场景四字段与 state.polisher 一一对应，正文含润色建议；
- polish_status 缺失时透传空串；
- fallback（polished == original）正文无润色建议但 metadata 仍无条件挂载；
- polisher 为空字典不抛异常，polisher_data 挂载全空串；
- 正文文案不变（research R6：首行「当前语句没有错误」固定）。
运行：uv run pytest tests/unit_tests/test_polisher_message_node.py -v
"""

from langchain_core.messages import AIMessage

from src.talk_agent.talk_graph import polisher_reply_message_node


def _get_ai_message(result: dict) -> AIMessage:
    messages = result["messages"]
    assert len(messages) == 2
    first = messages[0]
    assert isinstance(first, AIMessage)
    return first


def _polisher_state(**overrides) -> dict:
    base = {
        "original_text": "Recently, I am learning English.",
        "polished_text": "I've been learning English lately.",
        "explanation": "现在进行时改为现在完成进行时更自然。",
        "polish_status": "success",
    }
    base.update(overrides)
    return base


def test_success_metadata_mounted_with_four_fields():
    state = {"polisher": _polisher_state()}
    msg = _get_ai_message(polisher_reply_message_node(state))
    data = msg.additional_kwargs["metadata"]["polisher_data"]
    assert data["raw_text"] == "Recently, I am learning English."
    assert data["polished_text"] == "I've been learning English lately."
    assert data["explanation"] == "现在进行时改为现在完成进行时更自然。"
    assert data["polish_status"] == "success"


def test_success_content_keeps_plain_text_template():
    state = {"polisher": _polisher_state()}
    msg = _get_ai_message(polisher_reply_message_node(state))
    lines = msg.content.split("\n")
    assert lines[0] == "当前语句没有错误，没有tutor_reply。"
    assert any(line.startswith("润色建议：") for line in lines)


def test_missing_polish_status_passes_empty_string():
    state = {"polisher": _polisher_state(polish_status=None)}
    del state["polisher"]["polish_status"]
    msg = _get_ai_message(polisher_reply_message_node(state))
    assert msg.additional_kwargs["metadata"]["polisher_data"]["polish_status"] == ""


def test_fallback_still_mounts_metadata_without_suggestion():
    polished = "Recently, I am learning English."
    state = {"polisher": _polisher_state(polished_text=polished, polish_status="fallback")}
    result = polisher_reply_message_node(state)
    msg = _get_ai_message(result)
    # 正文降级：仅「没有错误」一行，无润色建议
    assert msg.content == "当前语句没有错误，没有tutor_reply。"
    # metadata 无条件挂载（contract §1），降级判断归前端守卫（FR-009）
    data = msg.additional_kwargs["metadata"]["polisher_data"]
    assert data["polished_text"] == polished
    assert data["polish_status"] == "fallback"


def test_empty_polisher_no_exception_and_mounted():
    msg = _get_ai_message(polisher_reply_message_node({"polisher": {}}))
    assert msg.content == "当前语句没有错误，没有tutor_reply。"
    data = msg.additional_kwargs["metadata"]["polisher_data"]
    assert data == {
        "raw_text": "",
        "polished_text": "",
        "explanation": "",
        "polish_status": "",
    }
