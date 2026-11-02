"""ise_analyze_node：ISE 评测 XML → LLM 发音点评（父图节点，非子图）。

职责：把 xfyun_ise_tool_node 存进 State 的原始评测 XML（ise_xml_info）
转成学习者能懂的发音点评（ise_check_results）。

处理管线（代码解析优先，LLM 只做点评）：
1. 确定性解析 XML —— 已知坑：paper 节点中英文标签不同（按 rec_paper 第一个子节点通用取）、
   词名在 word 的 content 属性（symbol 是拼音）、中文引擎无逐词分数（英文引擎有）
2. 分数量表归一化 —— 中文引擎百分制(0-100)，英文引擎 5 分制(0-5)；
   非 cn 引擎统一 ×(100/5) 换算成百分制，下游/前端用同一张量表（原始 XML 不动）
3. 压成几百字摘要（6000 字符原始 XML 大多是时间戳噪音，直接喂 LLM 又贵又漏）
4. LLM 结构化输出：check_pronunciation 逐词点评 + scoring_advice 整体建议

边界处理（不浪费 LLM 调用，也绝不炸图）：
- 没 XML（no_audio/no_ref/unavailable）→ 按 ise_status 短路降级
- is_rejected（读的内容与参考句不符）→ 分数无效，确定性拦截
- 瞬态异常上抛 → RetryPolicy 重试；非瞬态/无 key → 降级 dict
"""

import os
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

# 兼容直接运行本文件：把 backend 目录加入 sys.path；
# langgraph dev / uv run 下 backend 本就在 sys.path，无副作用
_BACKEND_DIR = Path(__file__).resolve().parents[4]  # backend/src/talk_agent/subgraphs/grammar_check_subgraph/ise_analyze_node.py -> backend（子图包内比 talk_agent 深两级）
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from dotenv import load_dotenv
from pydantic import BaseModel, Field
from langchain_core.messages import SystemMessage, HumanMessage
from langchain_deepseek import ChatDeepSeek
from langgraph.constants import TAG_NOSTREAM

from src.talk_agent.state import OverAllState  # noqa: E402
from src.talk_agent.utils import is_transient  # noqa: E402  公共瞬态判定（PR 评审：提炼为公共函数）

# 复用 backend/.env（DEEPSEEK_API_KEY 在里面）
load_dotenv(_BACKEND_DIR / ".env")

# ========== LLM 输出契约 ==========


class PronunciationItem(BaseModel):
    """单个词的发音点评。"""

    word: str = Field(description="被评测的词语，来自 ISE 逐词结果")
    score: float | None = Field(
        default=None,
        description="该词得分（统一百分制）；中文引擎(cn_vip)的 word 节点没有逐词分数，此时必须为 None，不要编造",
    )
    comment: str = Field(description="面向学习者的中文点评，指出读得如何；有异常标记的要具体说明怎么改")


class IseAnalysis(BaseModel):
    """LLM 结构化输出契约：ISE XML 分析结果。"""

    check_pronunciation: list[PronunciationItem] = Field(description="发音逐词分析，每个词一条")
    scoring_advice: str = Field(description="整体评分建议（中文），最多 3 条可执行的改进动作")


# ========== XML 确定性解析 ==========

# syll 节点 dp_message 异常码（讯飞文档）：16=增读 32=漏读 64=回读 128=替换
DP_MESSAGE = {16: "增读", 32: "漏读", 64: "回读", 128: "替换"}


def _pct(value, max_score: float) -> float | None:
    """原始分 → 百分制；解析不出返回 None（缺逐词分/坏数据不编造）。"""
    if value in (None, ""):
        return None
    try:
        return round(float(value) / max_score * 100, 2)
    except (TypeError, ValueError):
        return None


def parse_ise_xml(xml_str: str, max_score: float = 100.0) -> dict | None:
    """把评测 XML 解析成紧凑结构；解析不出 rec_paper 返回 None。

    max_score：原始分数量表满分——cn 引擎 100（默认），en 引擎 5；
    所有分数（总分/四项分/逐词分）统一换算成百分制输出。
    """
    try:
        root = ET.fromstring(xml_str)
        rec_paper = root.find(".//rec_paper")
        if rec_paper is None or len(rec_paper) == 0:
            return None
        paper = list(rec_paper)[0]

        words = []
        for w in paper.iter("word"):
            flags = []
            for syl in w.findall("syll"):
                dp = int(syl.get("dp_message", "0") or 0)
                if dp:
                    flags.append(DP_MESSAGE.get(dp, f"dp{dp}"))
                for ph in syl.findall("phone"):
                    if int(ph.get("perr_msg", "0") or 0):
                        flags.append("音素异常")
            words.append(
                {
                    "word": w.get("content", ""),
                    "pinyin": next(
                        (s.get("symbol") for s in w.findall("syll") if s.get("symbol")), ""
                    ),
                    # 英文引擎 word 节点有 total_score（如 4.949159），中文没有 → None
                    "score": _pct(w.get("total_score"), max_score),
                    "flags": flags,
                }
            )

        # 语速推导（003 评分区，research.md R3；2026-11-02 真实样本核对：
        # 英文引擎 rec_paper 子节点无 time_len，时长由 beg_pos/end_pos 帧位差
        # 推出（讯飞 ISE 帧移 10ms/帧，992 帧 ≈ 9.92s 与实际音频吻合）；
        # 词数优先 word_count 属性（words 数组含 sil 静音标记不可靠）。
        # time_len 保留为兼容路径（部分引擎样本存在）；任一要素缺失/非法 →
        # None（前端仪表盘空态，不虚构）
        speed_wpm = None
        try:
            raw_time_len = paper.get("time_len")
            if raw_time_len not in (None, ""):
                duration_ms = int(raw_time_len)
            else:
                beg_pos = int(paper.get("beg_pos", "") or 0)
                end_pos = int(paper.get("end_pos", "") or 0)
                duration_ms = (end_pos - beg_pos) * 10
            # 词数：优先 word_count 属性；缺失时回退非静音逐词数（words 含 sil）
            raw_word_count = paper.get("word_count")
            word_count = int(raw_word_count) if raw_word_count not in (None, "") else sum(
                1 for w in words if w["word"].strip().lower() not in ("sil", "sp", "pause")
            )
            if duration_ms > 0 and word_count > 0:
                speed_wpm = round(word_count / (duration_ms / 60000), 1)
        except (TypeError, ValueError):
            speed_wpm = None

        return {
            "total": _pct(paper.get("total_score"), max_score),
            "accuracy": _pct(paper.get("accuracy_score"), max_score),
            "fluency": _pct(paper.get("fluency_score"), max_score),
            "integrity": _pct(paper.get("integrity_score"), max_score),
            "is_rejected": (paper.get("is_rejected", "false") or "false").lower() == "true",
            "speed_wpm": speed_wpm,
            "words": words,
        }
    except ET.ParseError:
        return None


def _build_summary(info: dict) -> str:
    """把解析结果压成 LLM 可读的小摘要。"""
    lines = [
        f"总分 {info['total']}分（百分制；准确 {info['accuracy']} / 流利 {info['fluency']} / 完整 {info['integrity']}）",
        "逐词结果：",
    ]
    for w in info["words"]:
        line = f"- {w['word']}({w['pinyin']})"
        if w.get("score") is not None:
            line += f" {w['score']}分"
        if w["flags"]:
            line += f"：异常 {('、'.join(w['flags']))}"
        lines.append(line)
    return "\n".join(lines)


# ========== LLM 配置（无 key 时降级，节点走 unavailable 路径） ==========

_api_key = os.getenv("DEEPSEEK_API_KEY")
if _api_key:
    analyzer = (
        ChatDeepSeek(model=os.getenv("DEEPSEEK_MODEL", "deepseek-chat"), api_key=_api_key, temperature=0)
        .with_structured_output(IseAnalysis)
        # TAG_NOSTREAM：内部结构化调用的 tool_call chunks 不进 messages 流（否则前端出现幽灵 tool call）
        .with_config(tags=[TAG_NOSTREAM])
    )
else:
    analyzer = None
    print("[警告] 未配置 DEEPSEEK_API_KEY，ise_analyze_node 将降级")

ANALYZE_PROMPT = (
    "你是发音点评助手，依据 ISE 评测摘要生成交互式点评。规则：\n"
    "1. check_pronunciation：每个词一条，comment 用中文、面向学习者，"
    "有异常标记的词要具体说明问题（如漏读=这个词没读出来）和怎么改。\n"
    "2. score 字段：直接引用摘要给的百分制分数；摘要里没有逐词分数时必须为 null，禁止编造。\n"
    "3. scoring_advice：整体建议，最多 3 条可执行的改进动作。\n"
    "4. 语气鼓励、简明，不逐字复述摘要。\n"
    "5. 只点评发音，不评价语法对错、不给出正确句子——语法纠错由下游节点负责。"
)


# ========== 节点 ==========


def _degraded(reason: str) -> dict:
    """降级输出：pronunciation 置空，advice 说明原因（下游可直接展示）。"""
    return {"ise_check_results": {"pronunciation": [], "advice": reason}}


def ise_analyze_node(state: OverAllState) -> OverAllState:
    """XML → LLM 发音点评：读 ise_xml_info，产出 ise_check_results。

    - ise_status 独立于 grammar_check_status，本节点失败绝不阻塞语法主链路
    - 瞬态异常上抛 → RetryPolicy（挂载时指定）；非瞬态/无 key → 降级 dict
    """
    xml = (state.get("ise_xml_info") or "").strip()
    if not xml:
        return _degraded(f"本次无发音评测数据（ise_status={state.get('ise_status', 'unknown')}），跳过点评")

    # 量表满分：评测引擎固定英文 en_vip，5 分制——解析层归一化成统一百分制
    info = parse_ise_xml(xml, max_score=5.0)
    if info is None:
        return _degraded("评测结果 XML 解析失败，无法点评")
    if info["is_rejected"]:
        return _degraded("读的内容与参考句不匹配（is_rejected），本次分数无效，请按参考句重新朗读")

    if analyzer is None:
        return _degraded("未配置 DEEPSEEK_API_KEY，发音点评暂不可用")

    try:
        res: IseAnalysis = analyzer.invoke(
            [SystemMessage(content=ANALYZE_PROMPT), HumanMessage(content=_build_summary(info))]
        )
    except Exception as e:
        if is_transient(e):
            raise  # 瞬态上抛 → RetryPolicy；3 次耗尽由调用方兜底
        return _degraded(f"点评生成失败（{type(e).__name__}），请稍后重试")

    return {
        "ise_check_results": {
            "pronunciation": [item.model_dump() for item in res.check_pronunciation],
            "advice": res.scoring_advice,
            # 003 评分区（Constitution II 字段透出）：parse_ise_xml 既有产物原样透出，
            # 零新计算；降级路径 _degraded 不带这些字段（缺省 = 前端空态）
            "scores": {
                "total": info["total"],
                "accuracy": info["accuracy"],
                "fluency": info["fluency"],
                "integrity": info["integrity"],
            },
            "speed_wpm": info.get("speed_wpm"),
        }
    }


if __name__ == "__main__":
    # 冒烟：纯解析单测 + 降级路径（不调 LLM、不调讯飞）
    fake_rejected = (
        '<xml_result><read_sentence><rec_paper>'
        '<read_chapter total_score="0" is_rejected="true" accuracy_score="0" fluency_score="0" integrity_score="0">'
        "</read_chapter></rec_paper></read_sentence></xml_result>"
    )
    assert parse_ise_xml(fake_rejected)["is_rejected"] is True
    assert parse_ise_xml("<bad>xml") is None
    print("解析单测：rejected 拦截 + 坏 XML 防御  通过")

    # 003 语速透出冒烟（2026-11-02 真实样本核对后）：time_len 兼容路径
    # 2 词/60000ms → 2.0 词/分；帧位差路径（真实英文引擎结构，帧移 10ms）
    # 19 词/992 帧 ≈ 114.9 词/分；要素缺失 → None
    fake_timed = (
        '<xml_result><read_sentence><rec_paper>'
        '<read_syllable total_score="4" accuracy_score="4" fluency_score="4" integrity_score="4" time_len="60000">'
        '<word content="hello" total_score="4"><syll><phone perr_msg="0"/></syll></word>'
        '<word content="world" total_score="4.5"><syll><phone perr_msg="0"/></syll></word>'
        "</read_syllable></rec_paper></read_sentence></xml_result>"
    )
    timed = parse_ise_xml(fake_timed, max_score=5.0)
    assert timed["speed_wpm"] == 2.0, timed["speed_wpm"]
    fake_frames = (
        '<xml_result><read_sentence><rec_paper>'
        '<read_chapter total_score="4.8" accuracy_score="4.7" fluency_score="5" '
        'integrity_score="5" beg_pos="0" end_pos="992" word_count="19">'
        '<word content="last" total_score="4.27"><syll dp_message="0"><phone perr_msg="0"/></syll></word>'
        "</read_chapter></rec_paper></read_sentence></xml_result>"
    )
    framed = parse_ise_xml(fake_frames, max_score=5.0)
    assert framed["speed_wpm"] == 114.9, framed["speed_wpm"]
    assert parse_ise_xml(fake_rejected)["speed_wpm"] is None
    print("解析单测：speed_wpm（time_len 兼容 + 帧位差真实结构 + 缺失空态）  通过")

    out = ise_analyze_node({"ise_status": "no_audio", "ise_xml_info": ""})
    assert out["ise_check_results"]["pronunciation"] == []
    print("降级路径：no_xml 短路  通过")
