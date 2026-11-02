
"""英语润色子图独立测试。"""

import os
import sys
from pathlib import Path

# 兼容直接运行本文件：把 backend 目录加入 sys.path，使 src.* 绝对导入可用；
# uv run / langgraph dev 下 backend 本就在 sys.path，无副作用
_BACKEND_DIR = Path(__file__).resolve().parents[4]
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

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
    # 003 三风格验证：None = 模型未生成该风格（前端该 Tab 显示空态）
    for style_key in ("style_business", "style_british"):
        style = polisher.get(style_key)
        if style:
            print(f"{style_key}：", style.get("polished_text", ""))
            print(f"{style_key} 解释：", style.get("explanation", ""))
        else:
            print(f"{style_key}：", style)
    print("润色状态：", polisher.get("polish_status", ""))
    print("TTS 状态：", polisher.get("tts_status", ""))
    print("执行日志：", result.get("logger", []))

    # 需要测试音频时，再把 enable_tts 改为 True。
    audio_bytes = polisher.get("polished_audio", b"")

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
    sys.stdout.flush()
    # 讯飞 TTS 的 websocket 线程会滞留导致进程假死，显式退出（既有约定）
    os._exit(0)
