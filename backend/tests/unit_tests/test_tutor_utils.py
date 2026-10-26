"""tutor_utils 工具函数单测：纯函数，无需 API key / 网络 / TTS。"""

from src.talk_agent.subgraphs.grammar_check_subgraph.tutor_utils import (
    extract_corrections,
    extract_pronunciation_issues,
    format_issue,
    verify_corrections,
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


# ---------------- verify_corrections（防幻觉程序化校验） ----------------
RAW = "She go to school yesterday."


def test_verify_passes_legitimate_correction():
    """合法条目（wrong 逐字在原句中、correct 不同）→ 通过。"""
    items = [{"wrong": "She go", "correct": "She went to school yesterday.", "type": "grammar"}]
    checked, dropped = verify_corrections(items, RAW)
    assert checked == items
    assert dropped == []


def test_verify_drops_fabricated_wrong():
    """幻觉拦截：wrong 不在原句中（LLM 编造/改写原文）→ 丢弃，合法条目不受影响。"""
    items = [
        {"wrong": "She goes to school", "correct": "She went to school yesterday."},  # 编造（原文是 go）
        {"wrong": "go", "correct": "went"},  # 合法
    ]
    checked, dropped = verify_corrections(items, RAW)
    assert [c["wrong"] for c in checked] == ["go"]
    assert [d["wrong"] for d in dropped] == ["She goes to school"]


def test_verify_drops_noop_correction():
    """改了等于没改：correct 与 wrong 相同（忽略大小写）→ 丢弃。"""
    items = [{"wrong": "go", "correct": "GO"}]
    checked, dropped = verify_corrections(items, RAW)
    assert checked == []
    assert len(dropped) == 1


def test_verify_drops_incomplete_items():
    """缺 wrong 或缺 correct 的条目无法展示 → 丢弃。"""
    items = [
        {"wrong": "She go", "correct": ""},
        {"wrong": "", "correct": "She went"},
    ]
    checked, _ = verify_corrections(items, RAW)
    assert checked == []


def test_verify_case_insensitive_anchor():
    """锚定原文忽略大小写：wrong「she GO」仍算原句片段 → 通过。"""
    items = [{"wrong": "she GO", "correct": "she went"}]
    checked, dropped = verify_corrections(items, RAW)
    assert checked == items
    assert dropped == []


def test_verify_empty_raw_text_skips_anchor_rule():
    """raw_text 为空（无事实源）时跳过锚定规则，只查完整性与 no-op，不误杀。"""
    items = [{"wrong": "anything", "correct": "something"}]
    checked, dropped = verify_corrections(items, "")
    assert checked == items
    assert dropped == []


def test_verify_non_dict_and_invalid_container():
    """非 dict 条目丢弃；corrections 非 list 时返回空通过+空拦截。"""
    _, dropped = verify_corrections(["plain", {"wrong": "go", "correct": "went"}], RAW)
    assert len(dropped) == 1
    assert verify_corrections("not-a-list", RAW) == ([], [])
