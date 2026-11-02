# Contract: `POST /audio/tts`（前端 → 后端自定义 HTTP 路由）

**原型图**：`frontend/docs/mockups/子功能-对话演示气泡-单击发音或地道-弹出更多信息弹窗.jpg`
**挂载点**：`backend/src/webapp.py`（`langgraph.json` `http.app`，与既有 `POST /audio/transcribe`
同文件同模式）；前端经 `/api/audio/tts`（Next 代理 `app/api/[..._path]/route.ts` 原样转发）。
**用途**：弹窗四个播放源的按需合成——英音示范、美音示范（↻重读复用其二）、润色句 AI 朗读。

---

## 1. 请求

```
POST /audio/tts
Content-Type: application/json
```

```jsonc
{
  "text":  "Recently, I am learning English.",  // 必填，非空，≤ 500 字符（防御上限）
  "accent": "american"                          // 可选，"american"（默认）| "british"
}
```

## 2. 响应

| 状态码 | Content-Type | Body | 语义 |
|---|---|---|---|
| 200 | `audio/mpeg` | MP3 二进制流 | 合成成功，前端 `URL.createObjectURL` 播放 |
| 400 | `application/json` | `{"detail": "empty text"}` 等 | text 为空/超长/accent 非法 |
| 415 | `application/json` | `{"detail": "unsupported content-type"}` | 非 JSON |
| 500 | `application/json` | `{"detail": "tts failed: <reason>"}` | 讯飞 SDK 失败/超时 |

- 成功响应带 `Cache-Control: no-store`；前端按 `(text, accent)` 做内存级 Map 缓存
  （弹窗生命周期内去重，关闭弹窗不强制清缓存，新一轮覆盖策略由实现决定）。
- 音质约定与主链一致（讯飞在线 TTS，vixy 系默认参数，speed 沿用工具默认值）。

## 3. 后端实现约束（最小适配，Constitution 原则 II）

1. `xfyun_tts_tool_by_text` 增加**可选**参数 `vcn: str | None = None`：
   - `None` → 行为完全不变（`os.getenv("TTS_VCN", "vixy")` 兜底），既有调用方零感知；
   - 传值 → 透传给 `TtsClient(vcn=...)`（SDK `_build_param` 原生支持）。
2. `webapp.py` 内维护口音映射常量：
   ```python
   ACCENT_VCN = {"american": "vixy", "british": "catherine"}
   # british=catherine：2026-11-02 用户试听六段同句候选音频后选定（讯飞英文女声）
   ```
   - 未知 accent → 400；`british` vcn 为 None/合成失败 → 500（前端对该控件置灰降级，FR-015）。
   - 映射表仅此一处；SDK 日志噪音屏蔽沿用 `polisher_tts.py` 顶部既有模式。
3. 同步 SDK 放线程池：`anyio.to_thread.run_sync(...)`（同 `/audio/transcribe` 模式）。
4. 不引入鉴权、不落盘、不改任何 graph 与节点。

## 4. 前端调用约束

- 单例播放器（一个隐藏 `<audio>`）：同一时刻只播一个源，新播放打断旧播放；
  循环跟读 = `audio.loop = true` + 按钮激活态，再次点击或关闭弹窗即停止。
- ↻重读：重放最近一次成功合成的示范音频（优先复用缓存，不发新请求）；无缓存时先合成再播。
- 任何非 200 响应：对应按钮短暂提示（tooltip/toast），不静默失败（FR-015 / SC-003）。
- 弹窗关闭（FR-014）：停止播放、`audio.loop` 复位、URL.revokeObjectURL 清理。
