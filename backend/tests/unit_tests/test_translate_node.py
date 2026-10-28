"""translate_node 单元测试（004-correction-translation，无需 API key）。

覆盖：route_entry 三分支路由、translate_node 正常译文 / 空输入跳过 LLM /
LLM 异常置空 / LLM 不可用置空 / 非 str content 置空。
LLM 调用全部 monkeypatch，不触网。
运行：uv run pytest tests/unit_tests/test_translate_node.py -v
"""

import pytest  # noqa: F401  # 保持与既有单测一致的 import 风格

from src.talk_agent.subgraphs.grammar_tutor_subgraph import grammar_tutor_subgraph as mod
from src.talk_agent.subgraphs.grammar_tutor_subgraph.grammar_tutor_subgraph import (
    route_entry,
    translate_node,
)


class _FakeReply:
    """模拟 AIMessage：仅用到 content 属性。"""

    def __init__(self, content):
        self.content = content


class _FakeModel:
    """模拟 ChatDeepSeek：记录调用、可注入回复或异常。"""

    def __init__(self, reply=None, exc: Exception | None = None):
        self._reply = reply
        self._exc = exc
        self.calls: list[list[dict]] = []

    def invoke(self, messages):
        self.calls.append(messages)
        if self._exc is not None:
            raise self._exc
        return self._reply


# ---------------- route_entry 三分支 ----------------


def test_route_entry_translate_priority():
    """翻译优先（防御性兜底）：前端契约规定 translate_request 与 tts_request 互斥携带。"""
    assert route_entry({"translate_request": True, "tts_request": True}) == "translate_node"


def test_route_entry_tts():
    assert route_entry({"tts_request": True}) == "tts_node"


def test_route_entry_main_chain():
    """两标记均缺省时走讲解主链（父图对话链永不为旁路字段，行为不受影响）。"""
    assert route_entry({}) == "load_input_node"
    assert route_entry({"raw_text": "hello"}) == "load_input_node"


# ---------------- translate_node ----------------


def test_translate_success(monkeypatch):
    fake = _FakeModel(_FakeReply("  好好学习。 "))
    monkeypatch.setattr(mod, "_get_model", lambda: fake)
    res = translate_node({"raw_text": "good good study."})
    assert res["translation"] == "好好学习。"  # 输出已去首尾空白
    assert len(fake.calls) == 1  # 单次 LLM 调用


def test_translate_empty_input_skips_llm(monkeypatch):
    """空/纯空白/缺字段输入不调 LLM 直接返回空译文（契约 Edge Case）。"""
    fake = _FakeModel(_FakeReply("不应被调用"))
    monkeypatch.setattr(mod, "_get_model", lambda: fake)
    for state in ({"raw_text": ""}, {"raw_text": "   "}, {}):
        res = translate_node(state)
        assert res["translation"] == ""
    assert fake.calls == []  # 未触发任何 LLM 调用


def test_translate_llm_exception(monkeypatch):
    """LLM 调用异常置空串不抛错（同 tts_node 兜底风格，不阻塞旁路响应）。"""
    fake = _FakeModel(exc=RuntimeError("boom"))
    monkeypatch.setattr(mod, "_get_model", lambda: fake)
    res = translate_node({"raw_text": "hello"})
    assert res["translation"] == ""


def test_translate_model_unavailable(monkeypatch):
    """LLM 不可用（未配置 DEEPSEEK_API_KEY / 依赖缺失）置空串。"""
    monkeypatch.setattr(mod, "_get_model", lambda: None)
    res = translate_node({"raw_text": "hello"})
    assert res["translation"] == ""


def test_translate_non_str_content(monkeypatch):
    """AIMessage.content 为分块列表等非字符串形态时视为失败置空。"""
    fake = _FakeModel(_FakeReply([{"type": "text", "text": "分块"}]))
    monkeypatch.setattr(mod, "_get_model", lambda: fake)
    res = translate_node({"raw_text": "hello"})
    assert res["translation"] == ""
