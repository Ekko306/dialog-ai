"""grammar_tutor 子图：语法纠错讲解（总流程图中 has_issue=True 的分支）。

职责边界（与上游 grammar_check 的契约）：
- grammar_check 负责发现问题：check_results（LLM 解析 XML 的结构化清单：语法+发音）、issues（兼容旧字段）
- 本子图负责把问题讲清楚：tutor_reply（给人看的讲解）+ corrections（给前端用的结构化修正）
  + raw_audio（用户原句美式发音 MP3，供前端对照播放）+ tutor_audio（正确句美式发音 MP3，供前端示范跟读；
  TTS 失败置空对应字段，不阻塞讲解）
- 是否进入本子图由父图条件边（my_route）决定，进入即代表 has_issue=True

图：document/grammar_tutor_subgraph.drawio
纠错准则：skills/grammar-error-precision/SKILL.md（加载式注入提示词，进程内缓存）
"""

import json
import sys
from pathlib import Path
from typing import Literal

# 兼容直接运行本文件：把 backend 目录加入 sys.path，使 src.* 绝对导入可用；
# langgraph dev / uv run 下 backend 本就在 sys.path，无副作用
_BACKEND_DIR = Path(__file__).resolve().parents[3]  # subgraphs 比 graph.py 深一层
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from dotenv import load_dotenv  # noqa: E402
from pydantic import BaseModel, Field  # noqa: E402

from langgraph.graph import END, START, StateGraph  # noqa: E402

from src.talk_agent.state import SubgraphState  # noqa: E402
from src.tools.audio_tool.xfyun_tts.xfyun_tts_tool import xfyun_tts_tool_by_text  # noqa: E402

load_dotenv(override=True)


# ---------------- 子图局部 schema ----------------
class TutorState(SubgraphState, total=False):
    """本子图私有 schema：继承共享契约（SubgraphState），只追加内部传递字段。

    tutor_prompt 仅在 build_prompt → llm_call 之间流转，出了本子图无人读取，
    因此不放共享的 state.py（契约文件只放跨图字段）。
    """

    tutor_prompt: str  # build_prompt → llm_call 的内部提示词


# ---------------- 结构化输出 schema（with_structured_output 强约束 LLM 一次产出 reply + corrections） ----------------
class Correction(BaseModel):
    """单条修正：wrong 原文照抄，correct 必须是完整句子（供 TTS 整句朗读）。"""

    wrong: str = Field(description="原句中的错误片段（原文照抄）")
    correct: str = Field(description="修正后的完整句子（把原句中所有错误都改掉后的完整版本，供 TTS 整句朗读示范，不要只给修改片段）")
    type: str = Field(default="grammar")


class TutorOutput(BaseModel):
    """LLM 结构化输出契约：讲解文本 + 修正清单（无错误时 corrections 为空列表）。"""

    reply: str = Field(description="给学生的中文讲解，总长不超过250字")
    corrections: list[Correction] = Field(
        default_factory=list,
        description=(
            "需要向学生展示的修正条目。上游清单的修正经你核对合理时，必须逐条收录"
            "（wrong 原文照抄，correct 为修正后的完整句子）；表达不地道、中式英语等"
            "建议整句改写的问题同样收录（type 标注实际类型，如 chinese-style）；"
            "仅当你确认原句确实没有问题（上游误报）时才输出空列表。发音问题不计入。"
        ),
    )


# ---------------- LLM（团队约定见 document/prompt_Refactor.md：ChatDeepSeek） ----------------
# 懒加载 + 失败置 None：未配置 DEEPSEEK_API_KEY 或依赖缺失时返回 None，走 fallback 模板兜底
_model = None
_model_ready = False


def _get_model():
    global _model, _model_ready
    if not _model_ready:
        _model_ready = True
        try:
            from langchain_deepseek import ChatDeepSeek

            _model = ChatDeepSeek(
                model="deepseek-v4-flash",
                temperature=0.2,  # 纠错讲解要稳定
                top_p=0.9,
                extra_body={"thinking": {"type": "disabled"}},
            )
        except Exception:
            _model = None
    return _model


# 提示词常量独立声明，便于后续迭代（也可拆到独立提示词文件）
TUTOR_SYSTEM_PROMPT = (
    "你是英语口语辅导老师，学生正在练习英语口语。"
    "请把句子里的语法问题和发音问题讲清楚，要求："
    "1. 语法问题逐条讲解，每条先给出「错误 → 正确」的修改，再用一两句通俗的话解释原因；"
    "2. 先肯定说对的部分，语气鼓励友好；"
    "3. 用中文讲解，例句保留英文；"
    "4. 发音问题单独成段（明确说明这不属于语法错误）：逐个单词讲解，指出读错的词、"
    "用户实际读音（清单有标注时）、正确读法（用中文谐音或自然拼读通俗描述），"
    "并提示重音或易错音素，最后建议学生跟读正确句示范音频；"
    "5. 上游清单的修正经你核对合理时，corrections 必须收录该条目（correct 给修正后的完整句子）；"
    "中式英语、表达不地道等建议整句改写的问题同样收录（type 标注实际类型），"
    "仅当原句确实无问题时 corrections 才为空列表；"
    "6. 总长不超过 250 字。"
)


# ---------------- 纠错准则 Skill（加载式接入，参考 Agent Skills 的 SKILL.md 规范） ----------------
# 路径：src/talk_agent/skills/grammar-error-precision/SKILL.md
# 模块级缓存：进程内只读一次磁盘，避免每次请求 IO；开发期改动 SKILL.md 后重启进程生效
_SKILL_CACHE: dict[str, str] = {}


def load_tutor_skill() -> str:
    """读取纠错准则正文（剥离 YAML frontmatter 元数据）；文件缺失或不可读时返回空串，不阻塞流程。"""
    if "text" in _SKILL_CACHE:
        return _SKILL_CACHE["text"]
    skill_path = Path(__file__).resolve().parents[1] / "skills" / "grammar-error-precision" / "SKILL.md"
    try:
        text = skill_path.read_text(encoding="utf-8")
        if text.startswith("---"):  # --- 之间是 name/description 元数据，不进提示词
            blocks = text.split("---", 2)
            if len(blocks) == 3:
                text = blocks[2]
        text = text.strip()
    except OSError:
        text = ""
    _SKILL_CACHE["text"] = text
    return text


def _extract_corrections(check_results) -> list:
    """从上游 check_results 容错提取前端可用的修正结构 [{wrong, correct, type}]。

    check_results 是 check 队友 LLM 解析 XML 的 json，具体字段名以最终对齐为准；
    这里做常见字段名的容错映射，取不到就返回空列表（前端不渲染修正卡片，不影响主流程）。
    """
    if isinstance(check_results, dict):
        items = check_results.get("issues") or check_results.get("errors") or check_results.get("grammar") or []
    elif isinstance(check_results, list):
        items = check_results
    else:
        return []
    corrections = []
    for item in items if isinstance(items, list) else []:
        if not isinstance(item, dict):
            continue
        wrong = item.get("wrong") or item.get("error") or item.get("original") or ""
        correct = item.get("correct") or item.get("right") or item.get("suggestion") or ""
        if wrong or correct:
            corrections.append({"wrong": wrong, "correct": correct, "type": item.get("type", "grammar")})
    return corrections


def _extract_pronunciation_issues(check_results) -> list:
    """从 check_results 提取发音问题条目（容错映射常见字段名），供讲解与兜底回显。

    发音问题不属于语法错误，不进 corrections（前端修正卡片），只在讲解文本中单独说明。
    """
    if isinstance(check_results, dict):
        items = check_results.get("pronunciation") or []
    elif isinstance(check_results, list):
        items = [i for i in check_results if isinstance(i, dict) and i.get("type") == "pronunciation"]
    else:
        return []
    return [i for i in items if isinstance(i, dict)]


# ---------------- 节点 ----------------
def load_input_node(state: SubgraphState) -> SubgraphState:
    """读取上游结果：学生原句 raw_text + 错误列表 issues。"""
    raw_text = state.get("raw_text", "")
    issues = state.get("issues", [])
    return {"logger": [f"load_input: 原句长度 {len(raw_text)}，错误 {len(issues)} 条"]}


def build_prompt_node(state: TutorState) -> TutorState:
    """组装讲解提示词：纠错准则 Skill + 三级进料（check_results > issues > 整句降级）。"""
    raw_text = state.get("raw_text", "")
    issues = state.get("issues", [])
    check_results = state.get("check_results")

    # 三级进料：check_results（语法+发音结构化清单）优先，issues 次之，都无则整句讲解
    if check_results:
        results_json = json.dumps(check_results, ensure_ascii=False)
        user_part = (
            f"学生原句：{raw_text}\n"
            f"上游检查结果（语法错误 + 发音问题，json）：\n{results_json}\n"
            f"请逐条讲解语法问题；若清单含发音问题（如 pronunciation 条目），必须单独成段逐词讲解："
            f"读错的单词 + 用户实际读音（清单有标注时）+ 正确读法（中文谐音或自然拼读描述）+ 重音或易错音素提示，"
            f"并建议学生跟读正确句示范音频；发音问题不属于语法错误，不得计入语法修正。"
        )
        feed_label = "check_results"
    elif issues:
        issue_lines = "\n".join(f"{idx}. {item}" for idx, item in enumerate(issues, start=1))
        user_part = f"学生原句：{raw_text}\n语法检查发现的错误：\n{issue_lines}\n请逐条讲解。"
        feed_label = "issues"
    else:
        # 上游 grammar_check 尚未输出清单（占位阶段），降级为整句讲解，不阻塞流程
        user_part = f"学生原句：{raw_text}\n（暂无上游错误列表，请直接找出并讲解主要语法问题）"
        feed_label = "整句降级"

    skill_text = load_tutor_skill()
    parts = [TUTOR_SYSTEM_PROMPT]
    if skill_text:
        parts.append(f"以下是语法纠错规范（必须遵守）：\n{skill_text}")
    parts.append(user_part)
    return {
        "tutor_prompt": "\n\n".join(parts),
        "logger": [
            f"build_prompt: 进料 {feed_label}，纠错准则 Skill {'已注入' if skill_text else '未加载'}"
        ],
    }


def llm_call_node(state: TutorState) -> TutorState:
    """调用 LLM 结构化输出（with_structured_output + include_raw）：reply + corrections 一次产出。

    include_raw=True 时返回 {raw, parsed, parsing_error}，解析失败 parsed 为 None，
    交给 parse_validate 路由 fallback；任何异常同样置空输出走兜底。
    """
    model = _get_model()
    if model is None:
        return {"tutor_reply": "", "logger": ["llm_call: LLM 不可用，交由 fallback"]}
    try:
        result = model.with_structured_output(TutorOutput, include_raw=True).invoke(
            state.get("tutor_prompt", "")
        )
        parsed = result.get("parsed")
        if parsed is None:
            return {
                "tutor_reply": "",
                "logger": [f"llm_call: 结构化解析失败，交由 fallback（{result.get('parsing_error')}）"],
            }
        reply = parsed.reply.strip()
        corrections = [c.model_dump() for c in parsed.corrections]
    except Exception:
        reply, corrections = "", []
    return {
        "tutor_reply": reply,
        "corrections": corrections,
        "logger": [f"llm_call: 结构化输出 {'成功' if reply else '失败'}，corrections {len(corrections)} 条"],
    }


def fallback_node(state: SubgraphState) -> SubgraphState:
    """模板兜底：按 issues 逐条回显；发音条目单独提示；corrections 从 check_results 提取，前端数据不断供。"""
    issues = state.get("issues", [])
    if issues:
        lines = "\n".join(f"· {item}" for item in issues)
        reply = f"【语法小课堂】这几处可以再改一改：\n{lines}\n多练几次就顺手了，继续加油！"
    else:
        reply = "【语法小课堂】这句话的时态和主谓一致可以再检查一下，试着说一遍正确版本吧！"
    pron_issues = _extract_pronunciation_issues(state.get("check_results"))
    if pron_issues:
        pron_lines = "\n".join(
            f"· {p.get('word') or p.get('wrong') or '?'}：{p.get('correct') or p.get('suggestion') or '发音不够标准，请跟读示范音频'}"
            for p in pron_issues
        )
        reply += f"\n\n【发音提示】（以下不属于语法错误）\n{pron_lines}"
    corrections = _extract_corrections(state.get("check_results"))
    return {
        "tutor_reply": reply,
        "corrections": corrections,
        "logger": [f"fallback: 模板兜底，corrections {len(corrections)} 条，发音提示 {len(pron_issues)} 条"],
    }


def write_state_node(state: SubgraphState) -> SubgraphState:
    """结果落状态：corrections 优先取 LLM 结构化输出（llm_call 已写入），仅在缺失时才从上游 check_results 提取。

    用 is None 判断而非真值：LLM 判定无语法错误时 corrections 为空列表（如误报否决场景），
    空列表是有效裁决，不得被上游提取结果覆盖。
    """
    corrections = state.get("corrections")
    if corrections is None:
        corrections = _extract_corrections(state.get("check_results"))
    return {
        "corrections": corrections,
        "logger": [f"write_state: tutor_reply 已写回；corrections {len(corrections)} 条"],
    }


def tts_node(state: SubgraphState) -> SubgraphState:
    """两段美式发音 MP3（讯飞 TTS）：raw_audio（用户原句对照朗读）+ tutor_audio（改正后正确句示范朗读）。

    正确句优先取 corrections[0].correct（LLM 结构化输出，缺失时才从上游 check_results 提取）；
    无修正清单时降级朗读原句（此时两段相同，上游占位阶段不阻塞）。
    两段合成相互独立，任一失败只置空对应字段，讲解文本照常输出（与子图整体兜底风格一致）。
    """
    raw_text = state.get("raw_text", "")
    corrections = state.get("corrections")
    if corrections is None:
        corrections = _extract_corrections(state.get("check_results"))
    correct_text = corrections[0]["correct"] if corrections and corrections[0].get("correct") else ""

    raw_audio = b""
    if raw_text.strip():
        try:
            raw_audio = xfyun_tts_tool_by_text(raw_text)
        except Exception:
            raw_audio = b""

    speak_text = correct_text or raw_text
    tutor_audio = b""
    if speak_text.strip():
        try:
            tutor_audio = xfyun_tts_tool_by_text(speak_text)
        except Exception:
            tutor_audio = b""

    return {
        "raw_audio": raw_audio,
        "tutor_audio": tutor_audio,
        "logger": [
            f"tts: 原句「{raw_text}」合成 {'成功' if raw_audio else '失败/跳过'}（{len(raw_audio)} 字节）；"
            f"正确句「{speak_text}」（取自 {'corrections[0].correct' if correct_text else 'raw_text 降级'}）"
            f"合成 {'成功' if tutor_audio else '失败/跳过'}（{len(tutor_audio)} 字节）"
        ],
    }


# ---------------- 条件边（函数，非节点） ----------------
def parse_validate(state: SubgraphState) -> Literal["write_state_node", "fallback_node"]:
    """校验 LLM 输出是否可展示：非空即通过，否则走 fallback。"""
    if state.get("tutor_reply", "").strip():
        return "write_state_node"
    return "fallback_node"


# ---------------- 构建子图 ----------------
builder = StateGraph(state_schema=TutorState)
builder.add_node("load_input_node", load_input_node)
builder.add_node("build_prompt_node", build_prompt_node)
builder.add_node("llm_call_node", llm_call_node)
builder.add_node("fallback_node", fallback_node)
builder.add_node("write_state_node", write_state_node)
builder.add_node("tts_node", tts_node)

builder.add_edge(START, "load_input_node")
builder.add_edge("load_input_node", "build_prompt_node")
builder.add_edge("build_prompt_node", "llm_call_node")
builder.add_conditional_edges(
    "llm_call_node",
    parse_validate,
    {"write_state_node": "write_state_node", "fallback_node": "fallback_node"},
)
builder.add_edge("fallback_node", "write_state_node")
builder.add_edge("write_state_node", "tts_node")
builder.add_edge("tts_node", END)

grammer_tutor_subgraph = builder.compile()

if __name__ == "__main__":
    import os
    import tempfile

    def play_audio(res: dict, tag: str, autoplay: bool = False) -> None:
        """把 raw_audio / tutor_audio 落地临时 MP3；autoplay 时仅自动播正确句（避免多窗口连播）。"""
        for field, name in (("raw_audio", "原句"), ("tutor_audio", "正确句")):
            audio = res.get(field) or b""
            if audio:
                out = Path(tempfile.gettempdir()) / f"{field}_{tag}.mp3"
                out.write_bytes(audio)
                print(f"[{tag}] {name}发音已保存: {out}（{len(audio)} 字节）")
                if autoplay and field == "tutor_audio":
                    os.startfile(str(out))
            else:
                print(f"[{tag}] 无{name}发音（TTS 失败或无朗读文本）")

    # 场景1：上游给了 issues（grammar_check 升级后的正常路径）
    print("[场景1] 开始...")
    res = grammer_tutor_subgraph.invoke(
        {
            "raw_text": "She go to school yesterday.",
            "issues": ["go → went：一般过去时要用动词过去式"],
        }
    )
    print(res.get("tutor_reply"))
    play_audio(res, "场景1")  # 无 corrections → 降级朗读原句
    print("[场景1] 完成\n")
    # 场景2：上游没给 issues（当前占位阶段），自动降级为整句讲解
    print("[场景2] 开始...")
    res2 = grammer_tutor_subgraph.invoke({"raw_text": "He don't like apples."})
    print(res2.get("tutor_reply"))
    play_audio(res2, "场景2")
    print("[场景2] 完成\n")
    # 场景3：上游误判（I like apples 本来正确），验证纠错准则 Skill：
    # 准则要求 tutor 独立核对，不得顺着误判编造解释，应温和指出「这一点其实是正确的」
    print("[场景3] 开始...")
    res3 = grammer_tutor_subgraph.invoke(
        {
            "raw_text": "I like apples.",
            "issues": ["like → likes：主谓一致错误"],
        }
    )
    print(res3.get("logger"))
    print(res3.get("tutor_reply"))
    play_audio(res3, "场景3")
    # 场景4：上游升级版输入——check_results（语法+发音清单），验证发音讲解与 corrections 输出
    res4 = grammer_tutor_subgraph.invoke(
        {
            "raw_text": "Good good study, day day up.",
            "check_results": {
                "grammar": [
                    {"wrong": "Good good study, day day up", "correct": "Study hard and make progress every day", "type": "chinese-style"}
                ],
                "pronunciation": [
                    {"word": "study", "score": 62, "note": "/ˈstʌdi/ 重音在首音节"}
                ],
            },
        }
    )
    print(res4.get("logger"))
    print(res4.get("tutor_reply"))
    print("corrections:", res4.get("corrections"))
    play_audio(res4, "场景4", autoplay=True)  # 有 corrections → 朗读改正后的句子（主路径，自动播放）
    print("[场景4] 完成，全部测试结束")
    # SDK 的 TTS websocket 线程收完音频后滞留几十秒才退出，测试结束强制退出进程避免假死
    os._exit(0)
