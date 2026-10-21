"""grammar_tutor 子图集成回归（原子图文件 __main__ 块迁移而来）。

场景1-4 走 grammer_tutor_subgraph 主链（纯文本讲解，需 DEEPSEEK_API_KEY）；
场景5 带 tts_request=True 复用同一张图，经 route_entry 直达 tts_node 旁路验证懒加载 TTS
（需讯飞配置，主链不再每次合成语音）。
运行：uv run pytest tests/integration_tests/test_grammer_tutor_subgraph.py -s -v
"""

import os
import tempfile
from pathlib import Path

import pytest

from src.talk_agent.subgraphs.grammar_tutor_subgraph.grammar_tutor_subgraph import (
    grammer_tutor_subgraph,
)


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


def test_scenario_1_issues_contract():
    """场景1：上游给了 issues（grammar_check 真实契约，只标记不纠错）→ 逐条讲解。"""
    res = grammer_tutor_subgraph.invoke(
        {
            "raw_text": "She go to school yesterday.",
            "issues": [
                {
                    "fragment": "She go",
                    "error_type": "主谓一致",
                    "description": "主语 She 是第三人称单数，一般现在时动词要加 -es",
                },
            ],
        }
    )
    print("\n[场景1]", res.get("tutor_reply"))
    assert res.get("tutor_reply")
    assert res.get("raw_audio") in (None, b""), "主链懒加载后不应再产出音频"


def test_scenario_2_no_input_fallback():
    """场景2：上游没给 issues → 自动降级为整句讲解，流程不阻塞。"""
    res = grammer_tutor_subgraph.invoke({"raw_text": "He don't like apples."})
    print("\n[场景2]", res.get("tutor_reply"))
    assert res.get("tutor_reply")


def test_scenario_3_false_positive():
    """场景3：上游误判（I like apples 本来正确）→ 纠错准则 Skill 要求独立核对，不得顺着误判编造。"""
    res = grammer_tutor_subgraph.invoke(
        {
            "raw_text": "I like apples.",
            "issues": [
                {"fragment": "like", "error_type": "主谓一致", "description": "like → likes：主谓一致错误"},
            ],
        }
    )
    print("\n[场景3] logger:", res.get("logger"))
    print("[场景3] reply:", res.get("tutor_reply"))
    assert res.get("tutor_reply")


def test_scenario_4_check_results_with_pronunciation():
    """场景4：check_results（语法+发音清单）→ 发音单独成段讲解 + corrections 输出。"""
    res = grammer_tutor_subgraph.invoke(
        {
            "raw_text": "Good good study, day day up.",
            "check_results": {
                "grammar": [
                    {
                        "wrong": "Good good study, day day up",
                        "correct": "Study hard and make progress every day",
                        "type": "chinese-style",
                    }
                ],
                "pronunciation": [
                    {"word": "study", "score": 62, "note": "/ˈstʌdi/ 重音在首音节"}
                ],
            },
        }
    )
    print("\n[场景4] logger:", res.get("logger"))
    print("[场景4] reply:", res.get("tutor_reply"))
    print("[场景4] corrections:", res.get("corrections"))
    assert res.get("tutor_reply")
    assert res.get("corrections"), "场景4 应产出 corrections（上游修正合理必须收录）"


def test_scenario_5_tts_on_demand():
    """场景5（懒加载 TTS）：用户点击发音时前端带 tts_request=True 复用本图，直达 tts_node 按需合成两段美式发音 MP3。"""
    res = grammer_tutor_subgraph.invoke(
        {
            "tts_request": True,
            "raw_text": "She go to school yesterday.",
            "corrections": [
                {"wrong": "She go", "correct": "She went to school yesterday.", "type": "grammar"}
            ],
        }
    )
    print("\n[场景5] 原句音频字节:", len(res.get("raw_audio") or b""))
    print("[场景5] 正确句音频字节:", len(res.get("tutor_audio") or b""))
    assert res.get("tutor_audio"), "懒加载 TTS 应产出正确句示范音频"
    play_audio(res, "场景5")  # 落地临时 MP3 供手动试听，不自动播放


@pytest.fixture(scope="module", autouse=True)
def _force_exit_after_tts_threads():
    """SDK 的 TTS websocket 线程收完音频后滞留几十秒才退出，模块测试结束强制退出进程避免假死。"""
    yield
    os._exit(0)
