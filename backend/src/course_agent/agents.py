"""精品课的 AI 能力（DeepSeek 结构化输出 + 规则兜底）.

设计约束（research R7 / spec FR-017 / FR-018）：
- 六个能力都只产出「文案与判定」，**不产出流程控制**；下一个环节由图的条件边决定。
- 任何一次调用失败（超时、额度、解析失败）都重试 2 次，仍失败则返回规则兜底值，
  保证课时能走到完成，不返回 5xx。
"""

from __future__ import annotations

import os
from typing import Any, Literal

from pydantic import BaseModel, Field

from src.course_agent.text_match import normalize


# ---------------- 结构化输出模型 ----------------


class AnswerVerdict(BaseModel):
    """练习作答判定。"""

    verdict: Literal["correct", "acceptable", "incorrect"] = Field(
        description="correct=完全正确；acceptable=语义正确但表达不同；incorrect=不正确"
    )
    feedback: str = Field(description="给学习者的中文反馈，1~2 句，具体可执行")
    suggested: str = Field(default="", description="更自然的英文表达建议，可为空")


class TurnEvaluation(BaseModel):
    """角色扮演单轮评价。"""

    verdict: Literal["correct", "acceptable", "incorrect"] = Field(
        description="对学习者这一句的整体判定"
    )
    feedback: str = Field(description="中文反馈，指出可取之处与可改进点")
    suggested: str = Field(default="", description="更自然的英文说法，可为空")


class LessonSummaryOut(BaseModel):
    """课时总结。"""

    summary: str = Field(description="中文总结，2~3 句，点出本课掌握情况")
    suggestions: list[str] = Field(default_factory=list, description="1~3 条下一步建议")


class CoachPromptOut(BaseModel):
    """知识点环节的主动提问。"""

    question: str = Field(description="用中文主动向学习者提出的问题，要求当场用本课表达作答")
    hint: str = Field(description="中文引导提示：先想什么、怎么组织句子")


class CoachFeedbackOut(BaseModel):
    """知识点环节学习者作答后的引导反馈。"""

    verdict: Literal["correct", "acceptable", "incorrect"]
    feedback: str = Field(description="中文反馈，先肯定再指出一处可改进点")
    suggested: str = Field(default="", description="更自然的英文表达，可为空")
    hint: str = Field(default="", description="下一步中文引导：怎么练得更好")


class HintOut(BaseModel):
    """任一环节的提示（不直接给完整答案）。"""

    hint: str = Field(description="中文提示：指出思路、关键词或可套用的句式")


# ---------------- LLM 构造（懒加载） ----------------

_structured_cache: dict[tuple[type[BaseModel], float], Any] = {}
_plain_cache: dict[float, Any] = {}


def _api_key() -> str:
    key = os.getenv("DEEPSEEK_API_KEY")
    if not key:
        raise RuntimeError("DEEPSEEK_API_KEY not configured")
    return key


def _structured(model_cls: type[BaseModel], temperature: float = 0.0) -> Any:
    """构造 with_structured_output 链；缺 key 时抛错，由调用方兜底。"""
    key = (model_cls, temperature)
    if key not in _structured_cache:
        from langchain_deepseek import ChatDeepSeek

        base = ChatDeepSeek(
            model=os.getenv("DEEPSEEK_MODEL", "deepseek-chat"),
            api_key=_api_key(),
            temperature=temperature,
        )
        _structured_cache[key] = base.with_structured_output(model_cls)
    return _structured_cache[key]


def _plain(temperature: float = 0.4) -> Any:
    if temperature not in _plain_cache:
        from langchain_deepseek import ChatDeepSeek

        _plain_cache[temperature] = ChatDeepSeek(
            model=os.getenv("DEEPSEEK_MODEL", "deepseek-chat"),
            api_key=_api_key(),
            temperature=temperature,
        )
    return _plain_cache[temperature]


def _invoke_structured(model_cls: type[BaseModel], prompt: str, temperature: float = 0.0) -> Any | None:
    """带 2 次重试的结构化调用；任何失败返回 None。"""
    try:
        chain = _structured(model_cls, temperature)
    except Exception:
        return None
    for _ in range(2):
        try:
            return chain.invoke(prompt)
        except Exception:
            continue
    return None


# ---------------- 规则兜底 ----------------


def _rule_verify(answer: str, reference: str, key_points: list[str]) -> dict[str, Any]:
    """无 AI 时的确定性判定：归一化相等 → correct；命中关键点 → acceptable。"""
    norm_answer, norm_ref = normalize(answer), normalize(reference)
    if norm_answer and norm_answer == norm_ref:
        return {"verdict": "correct", "feedback": "表达正确，继续保持！", "suggested": ""}
    hit = [p for p in key_points if normalize(p) in norm_answer]
    if hit:
        return {
            "verdict": "acceptable",
            "feedback": f"意思表达清楚了（用到了 {', '.join(hit)}），可以更贴近参考表达。",
            "suggested": reference,
        }
    return {
        "verdict": "incorrect",
        "feedback": "这次还没有用上本课的表达，参考下面的说法再试一次。",
        "suggested": reference,
    }


# ---------------- 对外的六个能力 ----------------


def evaluate_answer(
    question: str, answer: str, reference: str, key_points: list[str]
) -> dict[str, Any]:
    """练习作答评价；语义正确但措辞不同视为 acceptable（spec FR-009）。"""
    prompt = (
        "你是英语口语助教。请根据题目判断学习者的作答。\n"
        f"题目：{question}\n"
        f"参考答案：{reference}\n"
        f"必须覆盖的要点：{', '.join(key_points) or '无'}\n"
        f"学习者作答：{answer}\n\n"
        "判定规则：\n"
        "1. 完全正确 → correct\n"
        "2. 意思正确但用词/句式与参考答案不同 → acceptable（不要因为不像参考答案而判错）\n"
        "3. 表达有误或没答到要点 → incorrect\n"
        "反馈用中文，具体指出哪里好、哪里可以改；suggested 用英文给出更自然的说法。"
    )
    out = _invoke_structured(AnswerVerdict, prompt, temperature=0.0)
    if out is None:
        return _rule_verify(answer, reference, key_points)
    return out.model_dump()


def roleplay_reply(history: list[dict[str, Any]], role: str, setting: str, opening_line: str) -> str:
    """按场景扮演角色，生成下一句台词；失败时用固定追问话术。"""
    lines = "\n".join(
        f"{'你' if m.get('role') == 'assistant' else '学习者'}: {m.get('text', '')}"
        for m in history
    )
    prompt = (
        f"你在英语口语角色扮演中扮演「{role}」。场景：{setting}\n"
        f"开场白：{opening_line}\n"
        f"目前对话：\n{lines or '（尚未开始）'}\n\n"
        "请用 1~2 句自然的英文回应学习者，保持角色口吻，句子简短、口语化，"
        "不要评价学习者，不要解释语法，只推进对话。"
    )
    try:
        text = _plain(temperature=0.5).invoke(prompt)
    except Exception:
        return "Interesting! Tell me a bit more about that."
    content = getattr(text, "content", "")
    return content.strip() if isinstance(content, str) and content.strip() else "That sounds good! What else?"


def evaluate_roleplay_turn(user_text: str, goal: str) -> dict[str, Any]:
    """角色扮演单轮评价 + 更自然的说法。"""
    prompt = (
        "你是英语口语教练，请评价学习者在角色扮演中的这一句。\n"
        f"本课目标：{goal}\n"
        f"学习者说：{user_text}\n\n"
        "反馈用中文，先肯定表达清楚的地方，再指出一处可改进点；"
        "suggested 给出更自然的英文说法（若已表达自然则留空）。"
    )
    out = _invoke_structured(TurnEvaluation, prompt, temperature=0.0)
    if out is None:
        return {"verdict": "acceptable", "feedback": "表达清楚了，继续保持。", "suggested": ""}
    return out.model_dump()


def generate_summary(
    lesson_name: str, target_sentence: str, evaluations: list[dict[str, Any]]
) -> dict[str, Any]:
    """生成课时总结；失败时用模板文本。"""
    details = "\n".join(
        f"- {e.get('stage', '环节')}：{e.get('verdict', '')} {e.get('feedback', '')}"
        for e in evaluations
    )
    prompt = (
        "你是英语口语教练，请为本节精品课写一段学习总结。\n"
        f"课时：{lesson_name}\n核心句：{target_sentence}\n各环节表现：\n{details or '（暂无记录）'}\n\n"
        "总结用中文，2~3 句，先肯定完成情况，再点出 1 处可提升；"
        "suggestions 给 1~3 条具体可执行的下一步建议。"
    )
    out = _invoke_structured(LessonSummaryOut, prompt, temperature=0.3)
    if out is None:
        return {
            "summary": f"本节课你练习了核心句「{target_sentence}」，完成了全部环节。继续在生活中用起来会更自然。",
            "suggestions": ["下次试着把今天的表达用在真实对话里", "再听一遍核心句的朗读，模仿语调"],
        }
    return out.model_dump()


# ---------------- 主动提问与引导（FR 新增） ----------------


def generate_teaching_prompt(
    lesson_name: str, target_sentence: str, points: list[dict[str, Any]]
) -> dict[str, Any]:
    """知识点讲完后，AI 主动抛出一个「用本课表达回答」的问题 + 引导提示。"""
    titles = "；".join(str(p.get("title", "")) for p in points) or "本课表达"
    examples = "；".join(str(p.get("example", "")) for p in points)
    prompt = (
        "你是英语口语教练。学习者刚学完一节精品课的知识点，请主动提问检验他/她是否会用。\n"
        f"课时：{lesson_name}\n核心句：{target_sentence}\n知识点：{titles}\n例句：{examples}\n\n"
        "要求：\n"
        "1. question 用中文提出一个贴近生活、必须用本课表达回答的问题（一句话，别太长）；\n"
        "2. hint 用中文给出思路引导（先想什么、套用哪个句式），但不要直接给出完整英文答案。"
    )
    out = _invoke_structured(CoachPromptOut, prompt, temperature=0.3)
    if out is None:
        example = (points[0].get("example") if points else "") or target_sentence
        return {
            "question": "试着用本课的表达，结合自己的情况说一句，你会怎么说？",
            "hint": f"先看例句「{example}」，把里面的关键词换成你自己的情况，再补成一个完整句子。",
        }
    return out.model_dump()


def coach_knowledge_answer(question: str, answer: str, target_sentence: str) -> dict[str, Any]:
    """评价知识点环节的作答，并给出下一步引导；失败时用规则兜底。"""
    prompt = (
        "你是英语口语教练，请评价学习者刚学完知识点后的这句即兴表达。\n"
        f"你提出的问题：{question or '用本课表达说一句'}\n"
        f"本课核心句：{target_sentence}\n"
        f"学习者回答：{answer}\n\n"
        "反馈用中文，先肯定表达清楚的地方，再指出一处可改进点；"
        "suggested 给出更自然的英文；hint 给一句下一步中文引导（怎么再练一次）。"
    )
    out = _invoke_structured(CoachFeedbackOut, prompt, temperature=0.0)
    if out is not None:
        return out.model_dump()

    words = [w for w in normalize(answer).split() if w]
    if len(words) >= 4:
        return {
            "verdict": "acceptable",
            "feedback": "句子已经成形，意思能听懂。",
            "suggested": target_sentence,
            "hint": "试着把这句话再说一遍，注意语调和停顿，会更自然。",
        }
    return {
        "verdict": "incorrect",
        "feedback": "这次句子还不太完整，先把核心表达说出来就够。",
        "suggested": target_sentence,
        "hint": "套用「主语 + 情绪/动作 + 场景」的顺序，先照着例句说一遍。",
    }


def exercise_hint(question: str, reference: str, key_points: list[str], attempt: int) -> dict[str, Any]:
    """练习环节的分层提示：第一次只给思路，之后逐步靠近参考说法。"""
    prompt = (
        "你是英语口语教练，学习者卡在这道练习题上，请给一句中文提示，不要直接给完整答案。\n"
        f"题目：{question}\n参考答案：{reference}\n要点：{', '.join(key_points) or '无'}\n"
        f"已尝试次数：{attempt}\n\n"
        "hint 用中文，指出该用哪个表达、句子怎么起头；"
        + ("第一次提示要含蓄，只给方向。" if attempt == 0 else "可以说得更具体，但仍让学习者自己组织完整句子。")
    )
    out = _invoke_structured(HintOut, prompt, temperature=0.3)
    if out is not None:
        return out.model_dump()
    if attempt == 0:
        keys = "、".join(key_points) or "本课的核心表达"
        return {"hint": f"先想想题目要用到哪个表达（提示：{keys}），把关键词说出来，再补成完整句子。"}
    return {"hint": f"可以直接套用这个句式改一改：{reference}"}


def roleplay_hint(role: str, setting: str, goal: str, ai_message: str) -> dict[str, Any]:
    """角色扮演卡壳时的提示：帮学习者找回应切入点，而不是替他/她说完。"""
    prompt = (
        f"你在英语口语角色扮演中扮演「{role}」。场景：{setting}\n"
        f"本课目标：{goal}\n对方刚说：{ai_message}\n\n"
        "学习者不知道该怎么接，请给一句中文提示："
        "帮他/她抓住对方话里的关键词、想好先回应什么，再补一句自己的信息；不要直接给完整英文台词。"
    )
    out = _invoke_structured(HintOut, prompt, temperature=0.3)
    if out is not None:
        return out.model_dump()
    return {"hint": f"先接住对方话里的关键词，再围绕「{goal or '本课目标'}」补一句自己的情况。"}

