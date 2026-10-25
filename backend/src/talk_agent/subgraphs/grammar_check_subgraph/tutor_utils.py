"""grammar_tutor 纯工具函数集（与 LangGraph 无关，不依赖任何图状态）。

从 grammer_tutor_subgraph.py 拆出，让子图文件专注 LangGraph 子图构建；
polisher 等其他子图如需同类容错提取/回显逻辑也可直接复用本模块。
"""

from pathlib import Path

# ---------------- 纠错准则 Skill（加载式接入，参考 Agent Skills 的 SKILL.md 规范） ----------------
# 路径：src/llm_models/prompts/skills/grammar-error-precision/SKILL.md
# 模块级缓存：进程内只读一次磁盘，避免每次请求 IO；开发期改动 SKILL.md 后重启进程生效
_SKILL_CACHE: dict[str, str] = {}


def load_tutor_skill() -> str:
    """读取纠错准则正文（剥离 YAML frontmatter 元数据）；文件缺失或不可读时返回空串，不阻塞流程。"""
    if "text" in _SKILL_CACHE:
        return _SKILL_CACHE["text"]
    skill_path = Path(__file__).resolve().parents[1] / "llm_models" / "prompts" / "skills" / "grammar-error-precision" / "SKILL.md"
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


def extract_corrections(check_results) -> list:
    """从上游清单容错提取前端可用的修正结构 [{wrong, correct, type}]。

    支持两种进料：
    - check_results（LLM 解析 XML 后的结构化清单）：grammar 条目自带 wrong/correct；
    - issues（grammar_check 输出的错误列表）：条目 {fragment, error_type, description}，
      上游只标记不纠错，correct 缺省为空串（正确句由 LLM 路径产出，兜底阶段不编造）。
    兼容映射常见字段名，取不到就返回空列表（前端不渲染修正卡片，不影响主流程）。
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
        wrong = item.get("wrong") or item.get("fragment") or item.get("error") or item.get("original") or ""
        correct = item.get("correct") or item.get("right") or item.get("suggestion") or ""
        if wrong or correct:
            corrections.append(
                {
                    "wrong": wrong,
                    "correct": correct,
                    "type": item.get("type") or item.get("error_type") or "grammar",
                }
            )
    return corrections


def format_issue(item) -> str:
    """单条 issue 转可读文本：dict 按 {fragment, error_type, description} 组装，str 原样（兼容旧结构）。"""
    if isinstance(item, dict):
        fragment = item.get("fragment") or item.get("wrong") or "?"
        error_type = item.get("error_type") or ""
        description = item.get("description") or ""
        head = f"[{error_type}] {fragment}" if error_type else fragment
        return f"{head}：{description}" if description else head
    return str(item)


def extract_pronunciation_issues(check_results) -> list:
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


def verify_corrections(corrections, raw_text: str) -> tuple[list, list]:
    """程序化事实校验（防幻觉外部验证器）：核查 LLM 产出的 corrections 与事实源（学生原句）的一致性。

    纯字符串运算，不调 LLM、零网络开销。核查规则：
    - 锚定原文：wrong 必须逐字出现在 raw_text 中（忽略大小写与首尾空白），否则视为编造 → 丢弃；
      raw_text 为空时跳过本规则（无事实源可对照，不能误杀）
    - 修正有效：correct 去空白后与 wrong 相同（改了等于没改）→ 丢弃
    - 条目缺 wrong 或缺 correct：信息不完整无法展示 → 丢弃

    返回 (通过列表, 拦截列表)，供节点写日志：拦截是静默降级，不报错、不阻塞讲解文本输出。
    """
    checked, dropped = [], []
    raw_lower = (raw_text or "").lower()
    for item in corrections if isinstance(corrections, list) else []:
        if not isinstance(item, dict):
            dropped.append(item if isinstance(item, dict) else {"wrong": str(item)})
            continue
        wrong = (item.get("wrong") or "").strip()
        correct = (item.get("correct") or "").strip()
        if not wrong or not correct:
            dropped.append(item)
            continue
        if correct.lower() == wrong.lower():
            dropped.append(item)
            continue
        if raw_lower and wrong.lower() not in raw_lower:
            dropped.append(item)
            continue
        checked.append(item)
    return checked, dropped
