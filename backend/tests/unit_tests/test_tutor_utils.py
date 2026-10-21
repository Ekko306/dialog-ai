"""tutor_utils 工具函数单测：纯函数，无需 API key / 网络 / TTS。"""

from src.talk_agent.tutor_utils import (
    extract_corrections,
    extract_pronunciation_issues,
    format_issue,
)


# ---------------- extract_corrections ----------------
def test_extract_from_check_results_grammar_key():
    """check_results 结构化清单：grammar 条目直接映射 wrong/correct/type。"""
    results = {
        "grammar": [
            {"wrong": "Good good study", "correct": "Study hard", "type": "chinese-style"}
        ],
        "pronunciation": [{"word": "study", "score": 62}],
    }
    assert extract_corrections(results) == [
        {"wrong": "Good good study", "correct": "Study hard", "type": "chinese-style"}
    ]


def test_extract_from_issues_dict_list():
    """issues 真实契约 {fragment, error_type, description}：wrong 对准 fragment，correct 缺省空串。"""
    issues = [
        {"fragment": "She go", "error_type": "主谓一致", "description": "第三人称单数动词要加 -es"}
    ]
    assert extract_corrections(issues) == [
        {"wrong": "She go", "correct": "", "type": "主谓一致"}
    ]


def test_extract_compat_field_names():
    """容错映射：error/original 等别名也能取到 wrong；right/suggestion 也能取到 correct。"""
    issues = [{"error": "He don't", "right": "He doesn't"}]
    assert extract_corrections(issues) == [{"wrong": "He don't", "correct": "He doesn't", "type": "grammar"}]


def test_extract_empty_or_invalid_inputs():
    """取不到就返回空列表：None / 空串 / 无关 dict / 非 dict 条目。"""
    assert extract_corrections(None) == []
    assert extract_corrections("") == []
    assert extract_corrections({"unrelated": 1}) == []
    assert extract_corrections(["plain string", 42]) == []


def test_extract_ignores_items_without_content():
    """wrong/correct 均为空的条目不产出。"""
    assert extract_corrections([{"description": "只有描述"}]) == []


# ---------------- format_issue ----------------
def test_format_issue_dict_full():
    """真实契约条目 → [类型] 片段：描述。"""
    item = {"fragment": "We talk", "error_type": "时态", "description": "过去动作用过去式"}
    assert format_issue(item) == "[时态] We talk：过去动作用过去式"


def test_format_issue_dict_partial():
    """缺字段时优雅降级。"""
    assert format_issue({"fragment": "We talk"}) == "We talk"
    assert format_issue({}) == "?"


def test_format_issue_str_passthrough():
    """旧结构 str 条目原样透传。"""
    assert format_issue("时态错误：We talk") == "时态错误：We talk"


# ---------------- extract_pronunciation_issues ----------------
def test_pronunciation_from_check_results():
    """dict 进料取 pronunciation 键。"""
    results = {
        "grammar": [{"wrong": "x", "correct": "y"}],
        "pronunciation": [{"word": "study", "score": 62, "note": "重音"}],
    }
    assert extract_pronunciation_issues(results) == [{"word": "study", "score": 62, "note": "重音"}]


def test_pronunciation_from_list_filters_by_type():
    """list 进料按 type=pronunciation 过滤，非 dict 剔除。"""
    items = [
        {"type": "pronunciation", "word": "study"},
        {"type": "grammar", "wrong": "x"},
        "not-a-dict",
    ]
    assert extract_pronunciation_issues(items) == [{"type": "pronunciation", "word": "study"}]


def test_pronunciation_empty_inputs():
    assert extract_pronunciation_issues(None) == []
    assert extract_pronunciation_issues({}) == []
    assert extract_pronunciation_issues(123) == []
