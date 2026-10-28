
"""英语润色子图独立测试。"""

from pathlib import Path

from src.talk_agent.subgraphs.polisher_subgraph.polisher_subgraph import (
    polisher_subgraph,
)

print("========== polisher_test.py 已启动 ==========", flush=True)

def main():
    test_state = {
        "raw_text": (
            "Yesterday I went to a restaurant with my friend. "
            "The food was very delicious and we had a very good time. "
            "I think I will go there again in the future."
        ),
        "user_input": "",
        "enable_tts": True,
        "logger": [],
    }

    result = polisher_subgraph.invoke(test_state)
    polisher = result.get("polisher", {})

    print("\n========== 英语润色测试 ==========")
    print("原文：", polisher.get("original_text", ""))
    print("润色结果：", polisher.get("polished_text", ""))
    print("中文解释：", polisher.get("explanation", ""))
    print("润色状态：", polisher.get("polish_status", ""))
    print("TTS 状态：", polisher.get("tts_status", ""))
    print("执行日志：", result.get("logger", []))

    # 需要测试音频时，再把 enable_tts 改为 True。
    # 音频在顶层公共字段 tutor_audio（与 tutor 分支同名字段，PR 评审契约）
    audio_bytes = result.get("tutor_audio", b"")

    if audio_bytes:
        output_dir = (
            Path(__file__).resolve().parents[4]
            / "output"
            / "polisher_output"
        )
        output_dir.mkdir(parents=True, exist_ok=True)

        audio_path = output_dir / "polished_audio.mp3"
        audio_path.write_bytes(audio_bytes)
        print("音频已保存：", audio_path)


if __name__ == "__main__":
    print("========== 开始执行润色子图 ==========", flush=True)
    main()
