"""AI 主动提问与引导能力：LLM 结构化输出 + 规则兜底。"""

import pytest

from src.course_agent import agents


@pytest.fixture()
def no_llm(monkeypatch):
    monkeypatch.setattr(agents, "_invoke_structured", lambda *args, **kwargs: None)


def test_generate_teaching_prompt_fallback(no_llm):
    out = agents.generate_teaching_prompt(
        "课时 A",
        "I'm in a good mood.",
        [{"title": "情绪表达", "example": "I'm in a good mood today."}],
    )

    assert out["question"]
    assert "I'm in a good mood today." in out["hint"]


def test_generate_teaching_prompt_uses_llm(monkeypatch):
    monkeypatch.setattr(
        agents,
        "_invoke_structured",
        lambda model, prompt, **kwargs: model(question="你今天心情怎么样？", hint="套用核心句回答"),
    )

    out = agents.generate_teaching_prompt("课时 A", "I'm in a good mood.", [])

    assert out == {"question": "你今天心情怎么样？", "hint": "套用核心句回答"}


def test_coach_knowledge_answer_accepts_sentence(no_llm):
    out = agents.coach_knowledge_answer(
        "你今天心情怎么样？", "I'm in a good mood today.", "I'm in a good mood."
    )

    assert out["verdict"] == "acceptable"
    assert out["suggested"] == "I'm in a good mood."
    assert out["hint"]


def test_coach_knowledge_answer_rejects_short_answer(no_llm):
    out = agents.coach_knowledge_answer("你今天心情怎么样？", "good", "I'm in a good mood.")

    assert out["verdict"] == "incorrect"
    assert out["suggested"] == "I'm in a good mood."


def test_exercise_hint_first_attempt_is_vague(no_llm):
    out = agents.exercise_hint("用本课表达造句", "I'm in a good mood.", ["mood"], 0)

    assert "mood" in out["hint"]
    assert "I'm in a good mood." not in out["hint"]


def test_exercise_hint_later_attempt_more_specific(no_llm):
    out = agents.exercise_hint("用本课表达造句", "I'm in a good mood.", [], 2)

    assert "I'm in a good mood." in out["hint"]


def test_roleplay_hint_fallback(no_llm):
    out = agents.roleplay_hint("朋友", "见面打招呼", "表达今天的心情", "How are you?")

    assert "表达今天的心情" in out["hint"]
