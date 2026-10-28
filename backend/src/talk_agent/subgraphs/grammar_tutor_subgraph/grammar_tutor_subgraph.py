"""grammar_tutor 子图：语法纠错讲解（总流程图中 has_issue=True 的分支）。

职责边界（与上游 grammar_check 的契约）：
- grammar_check 负责发现问题：check_results（LLM 解析 XML 的结构化清单：语法+发音）、issues（兼容旧字段）
- 本子图负责把问题讲清楚：tutor_reply（给人看的讲解）+ corrections（给前端用的结构化修正）
- 音频懒加载：主链不再每次回复都合成 TTS（用户未必点击发音），raw_audio / tutor_audio
  由本图 tts_node 旁路按需合成（公共属性，polisher 可复用）：前端点发音按钮时 invoke 本图
  并带 tts_request=True，入口条件边 route_entry 将其直达 tts_node；讲解调用不带该字段走主链
- 翻译懒加载（004）：原句中文译文由本图 translate_node 旁路按需产出，前端点「文A」时
  invoke 本图并带 translate_request=True 直达 translate_node（单次 LLM 纯文本调用）
- 是否进入本子图由父图条件边（my_route）决定，进入即代表 has_issue=True

图：document/grammar_tutor_subgraph.drawio
纠错准则：src/llm_models/prompts/skills/grammar-error-precision/SKILL.md（加载式注入提示词，进程内缓存）

纯工具函数（容错提取/回显/Skill 加载）已拆至 src/talk_agent/tutor_utils.py，
回归测试在 backend/tests/（unit_tests 测工具函数，integration_tests 跑 5 场景子图回归）。
本文件专注 LangGraph 子图构建：节点、条件边、图编译、LLM 与结构化输出 schema。
"""

import json
import sys
from pathlib import Path
from typing import Literal

# 兼容直接运行本文件：把 backend 目录加入 sys.path，使 src.* 绝对导入可用；
# langgraph dev / uv run 下 backend 本就在 sys.path，无副作用
_BACKEND_DIR = Path(__file__).resolve().parents[4]  # 子图在 subgraphs/grammar_tutor_subgraph/ 下，比 graph.py 深两层
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from dotenv import load_dotenv  # noqa: E402
from pydantic import BaseModel, Field  # noqa: E402

from langgraph.graph import END, START, StateGraph  # noqa: E402
from langgraph.constants import TAG_NOSTREAM  # noqa: E402

from src.talk_agent.state import SubgraphState  # noqa: E402
from src.talk_agent.subgraphs.grammar_check_subgraph.tutor_utils import (  # noqa: E402
    extract_corrections,
    extract_pronunciation_issues,
    format_issue,
    load_tutor_skill,
    verify_corrections,
)
from src.tools.audio_tool.xfyun_tts.xfyun_tts_tool import xfyun_tts_tool_by_text  # noqa: E402

load_dotenv(override=True)


# ---------------- 子图局部 schema ----------------
class TutorState(SubgraphState, total=False):
    """本子图私有 schema：继承共享契约（SubgraphState），只追加内部传递字段。

    tutor_prompt 仅在 build_prompt → llm_call 之间流转，出了本子图无人读取，
    因此不放共享的 state.py（契约文件只放跨图字段）。
    tts_request 同理：只服务本子图入口分流，父图 schema 无此 key，
    对话主链的状态合并不可能带上它——只有前端直接 invoke 本图才能触发发音旁路。
    """

    tutor_prompt: str  # build_prompt → llm_call 的内部提示词
    tts_request: bool  # 发音专用入口标记：前端点发音按钮 invoke 本图时传 True → route_entry 直达 tts_node
    translate_request: bool  # 翻译专用入口标记（004）：前端点「文A」invoke 本图时传 True → route_entry 直达 translate_node
    translation: str  # translate_node 产出：原句中文译文；空串 = 失败/空输入（仅旁路响应，父图链路不产生）


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
    "4. 发音问题单独成段（明确说明这不属于语法错误）：发音讲解只能依据上游清单给出的读音信息转述，"
    "禁止自行编造清单中没有的中文谐音或拼读描述；清单未标注读音的单词，只指出「该词发音需改进」，"
    "并引导用户听示范音频跟读；"
    "5. 上游清单的修正经你核对合理时，corrections 必须收录该条目（correct 给修正后的完整句子）；"
    "中式英语、表达不地道等建议整句改写的问题同样收录（type 标注实际类型），"
    "仅当原句确实无问题时 corrections 才为空列表；"
    "6. corrections 的 wrong 必须是学生原句中逐字存在的片段（可截取子串），"
    "禁止改写、缩写、概括原句后当作 wrong；"
    "7. 总长不超过 250 字。"
)


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
        issue_lines = "\n".join(f"{idx}. {format_issue(item)}" for idx, item in enumerate(issues, start=1))
        user_part = (
            f"学生原句：{raw_text}\n语法检查发现的错误（只标记了错误位置和原因，未给正确答案）：\n{issue_lines}\n"
            f"请逐条讲解，正确说法由你给出（corrections 的 correct 必须是修正后的完整句子）。"
        )
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

    输出后处理内联在本节点末尾（不设独立 verify 节点，避免拓扑膨胀）：
    调用 verify_corrections 做防幻觉程序化校验——corrections[].wrong 逐字锚定学生原句，
    编造/无效条目直接丢弃（纯函数实现在 tutor_utils，单测覆盖校验规则）。
    """
    model = _get_model()
    if model is None:
        return {"tutor_reply": "", "logger": ["llm_call: LLM 不可用，交由 fallback"]}
    reply, corrections, dropped = "", [], []
    try:
        result = model.with_structured_output(TutorOutput, include_raw=True).with_config(
            tags=[TAG_NOSTREAM]  # 内部结构化调用不进 messages 流（前端幽灵 tool call 根因）
        ).invoke(
            state.get("tutor_prompt", "")
        )
        parsed = result.get("parsed")
        if parsed is None:
            return {
                "tutor_reply": "",
                "logger": [f"llm_call: 结构化解析失败，交由 fallback（{result.get('parsing_error')}）"],
            }
        reply = parsed.reply.strip()
        corrections, dropped = verify_corrections(
            [c.model_dump() for c in parsed.corrections], state.get("raw_text", "")
        )
    except Exception:
        reply, corrections = "", []
    logs = [f"llm_call: 结构化输出 {'成功' if reply else '失败'}，corrections {len(corrections)} 条"]
    if dropped:
        logs.append(
            f"verify: 拦截编造/无效条目 {len(dropped)} 条，wrong={[d.get('wrong') for d in dropped]}"
        )
    return {
        "tutor_reply": reply,
        "corrections": corrections,
        "logger": logs,
    }


def fallback_node(state: SubgraphState) -> SubgraphState:
    """模板兜底：按 issues 逐条回显；发音条目单独提示；corrections 从 check_results 提取，前端数据不断供。"""
    issues = state.get("issues", [])
    if issues:
        lines = "\n".join(f"· {format_issue(item)}" for item in issues)
        reply = f"【语法小课堂】这几处可以再改一改：\n{lines}\n多练几次就顺手了，继续加油！"
    else:
        reply = "【语法小课堂】这句话的时态和主谓一致可以再检查一下，试着说一遍正确版本吧！"
    pron_issues = extract_pronunciation_issues(state.get("check_results"))
    if pron_issues:
        pron_lines = "\n".join(
            f"· {p.get('word') or p.get('wrong') or '?'}：{p.get('correct') or p.get('suggestion') or '发音不够标准，请跟读示范音频'}"
            for p in pron_issues
        )
        reply += f"\n\n【发音提示】（以下不属于语法错误）\n{pron_lines}"
    # check_results 提取不到时再从 issues 提取（fragment 对准；correct 缺省为空，正确句归 LLM 路径产出）
    corrections = extract_corrections(state.get("check_results")) or extract_corrections(issues)
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
        corrections = extract_corrections(state.get("check_results"))
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
        corrections = extract_corrections(state.get("check_results"))
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


# ---------------- 翻译旁路（004-correction-translation：文A 按需翻译，与 TTS 旁路同构） ----------------
TRANSLATE_SYSTEM_PROMPT = (
    "你是英译中翻译引擎。把用户给出的英文句子翻译成自然的中文口语。要求："
    "1. 以中文完整语义为主，准确传达原句意思，译文符合中文表达习惯；"
    "2. 中英混杂的原句，译文以中文完整语义为主，仅在必要时保留原英文词；"
    "3. 只输出译文本身：不要解释、不要引号、不要任何前缀或后缀；"
    "4. 简短自然，一句话能说清就不拆成多句。"
)


def translate_node(state: SubgraphState) -> SubgraphState:
    """按需翻译旁路（004）：前端点「文A」时 invoke 本图带 translate_request=True 直达本节点。

    单次 ChatDeepSeek 纯文本调用（不用 structured_output：单字符串字段无解析收益、徒增失败面）；
    空/纯空白输入不调 LLM；LLM 不可用或任何异常返回空串（同 tts_node 兜底风格，不抛错不阻塞）。
    译文写子图局部 translation 字段，仅经 /runs/wait 终态 values 供前端读取。
    """
    raw_text = state.get("raw_text", "")
    if not raw_text.strip():
        return {
            "translation": "",
            "logger": ["translate: raw_text 为空，跳过 LLM 调用直接返回空译文"],
        }
    model = _get_model()
    if model is None:
        return {
            "translation": "",
            "logger": ["translate: LLM 不可用（未配置 DEEPSEEK_API_KEY 或依赖缺失），返回空译文"],
        }
    try:
        reply = model.invoke(
            [
                {"role": "system", "content": TRANSLATE_SYSTEM_PROMPT},
                {"role": "user", "content": raw_text},
            ]
        )
        # AIMessage.content 理论上可能为分块列表，非字符串一律视为失败置空
        translation = reply.content.strip() if isinstance(reply.content, str) else ""
    except Exception:
        translation = ""
    return {
        "translation": translation,
        "logger": [
            f"translate: 「{raw_text}」→「{translation[:50]}」（{'成功' if translation else '失败/空'}）"
        ],
    }


# ---------------- 条件边（函数，非节点） ----------------
def route_entry(state: TutorState) -> Literal["tts_node", "translate_node", "load_input_node"]:
    """入口分流（三分支）：translate_request 直达翻译旁路，tts_request 直达发音旁路，其余走讲解主链。

    translate_request / tts_request 只在 TutorState（本子图局部 schema）声明，父图契约无此 key，
    正常对话链进本子图时永远不会带这些字段，主链行为不受影响。
    两者同时携带时翻译优先（前端契约规定互斥携带，此优先级仅为防御性兜底）。
    """
    if state.get("translate_request"):
        return "translate_node"
    if state.get("tts_request"):
        return "tts_node"
    return "load_input_node"


def parse_validate(state: SubgraphState) -> Literal["write_state_node", "fallback_node"]:
    """校验 LLM 输出是否可展示：非空直接落状态（事实校验已内联在 llm_call_node），空/解析失败走 fallback。"""
    if state.get("tutor_reply", "").strip():
        return "write_state_node"
    return "fallback_node"


# ---------------- 构建子图（单图三入口：讲解走主链，翻译/发音请求经 route_entry 直达各自旁路） ----------------
# 发音旁路契约：前端点发音按钮时 invoke 本图 {tts_request: True, raw_text, corrections?/check_results?}
# → 出参 {raw_audio, tutor_audio}；合成失败置空，不报错。
# 翻译旁路契约（004）：前端点「文A」时 invoke 本图 {translate_request: True, raw_text}
# → 出参 {translation}；失败/空输入置空串，不报错。
builder = StateGraph(state_schema=TutorState)
builder.add_node("load_input_node", load_input_node)
builder.add_node("build_prompt_node", build_prompt_node)
builder.add_node("llm_call_node", llm_call_node)
builder.add_node("fallback_node", fallback_node)
builder.add_node("write_state_node", write_state_node)
builder.add_node("tts_node", tts_node)
builder.add_node("translate_node", translate_node)

builder.add_conditional_edges(
    START,
    route_entry,
    {
        "tts_node": "tts_node",
        "translate_node": "translate_node",
        "load_input_node": "load_input_node",
    },
)
builder.add_edge("load_input_node", "build_prompt_node")
builder.add_edge("build_prompt_node", "llm_call_node")
builder.add_conditional_edges(
    "llm_call_node",
    parse_validate,
    {"write_state_node": "write_state_node", "fallback_node": "fallback_node"},
)
builder.add_edge("fallback_node", "write_state_node")
builder.add_edge("write_state_node", END)
builder.add_edge("tts_node", END)  # 发音旁路到 tts_node 即结束，不进讲解链节点
builder.add_edge("translate_node", END)  # 翻译旁路到 translate_node 即结束，不进讲解链节点

grammer_tutor_subgraph = builder.compile()


# 回归测试已迁至 backend/tests/：
# - unit_tests/test_tutor_utils.py：工具函数单测（无需 API key）
# - integration_tests/test_grammer_tutor_subgraph.py：5 场景子图回归（需 DEEPSEEK_API_KEY + 讯飞 TTS）
#   运行：uv run pytest tests/integration_tests/test_grammer_tutor_subgraph.py -s
