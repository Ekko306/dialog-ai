"""跟读比对纯函数单测（不依赖 API key / 网络）。"""

from src.course_agent.text_match import is_match, normalize

TARGET = "I'm in a really good mood today."


def test_normalize_lowercases_and_strips():
    assert normalize("  Hello World  ") == "hello world"


def test_normalize_removes_punctuation():
    """中英文标点、撇号都去掉，只保留字母数字与空格。"""
    assert normalize("I'm fine, thanks!") == "im fine thanks"
    assert normalize("你好，世界！") == "你好 世界"


def test_normalize_collapses_spaces():
    assert normalize("a   b\t\nc") == "a b c"


def test_normalize_non_string_returns_empty():
    assert normalize(None) == ""  # type: ignore[arg-type]
    assert normalize(123) == ""  # type: ignore[arg-type]


def test_match_ignores_case_and_punctuation():
    """大小写、首尾空白、标点、连续空格都不影响判定（spec FR-006）。"""
    assert is_match("im in a really good mood today", TARGET)  # 少撇号（语音转写常见）也通过
    assert is_match("I'M IN A REALLY GOOD MOOD TODAY", TARGET)
    assert is_match("  i'm in a really good mood today  ", TARGET)
    assert is_match("I'm  in a really good mood, today!", TARGET)


def test_match_rejects_different_content():
    assert is_match("I am happy", TARGET) is False
    assert is_match("I'm in a good mood", TARGET) is False
    assert is_match("", TARGET) is False
