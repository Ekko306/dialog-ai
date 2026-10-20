"""全链路音频测试：融合图（教练交互 + ISE 语音链路）端到端跑通。

图结构（合并后）：START → coach_reply → tts → HITL(interrupt 打断)
  → 恢复后按 user_input 路由：ita_audio 分支 → ita → ise → analyze
    → grammar_check → 三分支（tutor / polisher / fallback）→ coach_reply → END

两段式跑法（interrupt 需要 checkpointer 才能恢复）：
  1. 第一段 invoke：带上 audio_file_path + ref_text，跑到 HITL 打断停下
  2. 第二段 Command(resume)：模拟用户说了话（不含 "_new_context_" → 走 ita_audio 分支）

麦克风不会被触发：传了 audio_file_path，ita/ise 节点直接用本地文件。
运行方式：在 backend 目录下  python tests/integration_tests/full_chain_audio_test.py

注意：本文件是脚本式集成测试（真调讯飞/DeepSeek API），全部执行逻辑收在
main() + __main__ 守卫里——文件名匹配 pytest 的 *_test.py 收集规则，
没有守卫的话 pytest 收集阶段就会把整条链路跑一遍。
"""

import json
import sys
from pathlib import Path

# backend/tests/integration_tests/ → parents[2] = backend
_BACKEND_DIR = Path(__file__).resolve().parents[2]
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from langgraph.checkpoint.memory import MemorySaver
from langgraph.types import Command

from src.talk_agent.talk_graph import parent_builder


def main() -> None:
    # 测试素材：TTS 生成的英文长文（16kHz/16bit/单声道 PCM），内含 3 处语法错误
    audio_path = r"D:\shuo.learn\work project\dialog-ai\docs_f\audio\ttsmaker_en2_16k.pcm"
    ref_text = (
        "I went to school yesterday. I see many friends there. "
        "We talk about our homework. I like play basketball after class. "
        "It makes me happy."
    )

    # 支持命令行传参覆盖，等价于以前的一条命令测试：
    #   python full_chain_audio_test.py <音频路径> <ref_text>
    if len(sys.argv) >= 2:
        audio_path = sys.argv[1]
    if len(sys.argv) >= 3:
        ref_text = sys.argv[2]
    print(f"音频: {audio_path}")
    print(f"ref_text: {ref_text}")

    # 用独立 checkpointer 编译（talk_graph 里的 graph 没带 checkpointer，
    # 而 interrupt 必须有 checkpointer 才能暂停/恢复）
    graph = parent_builder.compile(checkpointer=MemorySaver())
    config = {"configurable": {"thread_id": "full-chain-audio-test"}}

    # ---- 第一段：跑到 HITL 打断 ----
    print("=" * 60)
    print("第一段：invoke 启动，预期停在 HITL 打断点")
    print("=" * 60)
    result = graph.invoke({"audio_file_path": audio_path, "ref_text": ref_text}, config)
    interrupts = result.get("__interrupt__") if isinstance(result, dict) else result
    print(f"打断信息: {interrupts}")

    s1 = graph.get_state(config)
    print(f"第一段后 next={s1.next} | interrupts={s1.interrupts}")
    print(f"第一段后 tasks={[(t.name, t.error, bool(getattr(t, 'interrupt', None))) for t in s1.tasks]}")

    # ---- 循环恢复：图里有多处 interrupt（coach 子图内部 1 处 + 父图 HITL 1 处，
    #      语音分支跑完汇入 coach_reply 后还会再进 HITL 一轮）----
    # 每次恢复都喂 "go"（不含 "_new_context_" → 走 ita_audio 语音分支）；
    # 一旦语音链路出了结果（iat_status 有值）就停止恢复，直接读 State
    print("=" * 60)
    print("循环 resume 恢复执行，直到语音链路跑完")
    print("=" * 60)
    for i in range(1, 5):
        snap = graph.get_state(config)
        has_pending = any(getattr(t, "interrupts", ()) for t in snap.tasks)
        if not has_pending:
            print(f"第 {i} 次检查：无待恢复打断，停止（next={snap.next}）")
            break
        pending = [t.name for t in snap.tasks if getattr(t, "interrupts", ())]
        print(f"第 {i} 次 resume：待恢复任务={pending} → 喂入 'go'")
        graph.invoke(Command(resume="go"), config)
        cur = graph.get_state(config).values
        if cur.get("iat_status"):
            print(f"语音链路已跑完（iat_status={cur.get('iat_status')}），停止恢复")
            break

    snap = graph.get_state(config)
    print(f"停在哪: next={snap.next}")
    print(f"待处理任务: {[ (t.name, getattr(t, 'error', None)) for t in snap.tasks ]}")

    hist = list(graph.get_state_history(config))
    print(f"checkpoint 历史共 {len(hist)} 步（新→旧）:")
    for h in hist[:8]:
        print(f"  step={h.metadata.get('step')} next={h.next} tasks={[t.name for t in h.tasks]} writes={list((h.tasks[0].result if h.tasks and h.tasks[0].result else {})) if h.tasks else []}")

    final = snap.values
    print("=" * 60)
    print("最终 State 全量字段")
    print("=" * 60)
    for k, v in final.items():
        if k == "audio_data":
            print(f"{k:22s}: <bytes {len(v or b'')}>")
        elif k == "ise_xml_info":
            print(f"{k:22s}: <xml {len(v or '')} chars>")
        elif k == "messages":
            print(f"{k:22s}: <{len(v or [])} messages>")
        else:
            print(f"{k:22s}: {str(v)[:600]}")

    # 等 LangSmith trace 上传完成再退出（LANGSMITH_TRACING=true 时全程自动记录）
    try:
        from langsmith import Client

        Client().flush()
        print("trace 已上传 → https://smith.langchain.com → Tracing → new-agent 查看")
    except ImportError:
        pass


if __name__ == "__main__":
    main()
