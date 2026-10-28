# Quickstart: 纠错气泡原句翻译（文A）手动验收指南

**Feature**: 004-correction-translation | **Date**: 2026-10-26

前置：后端已加 translate 旁路（`pnpm dev:backend`，127.0.0.1:2024）+ 前端 dev server（`pnpm dev:frontend`，localhost:3000）。验收布局基准：spec.md Assumptions 第 6 条「翻译位置布局」；气泡整体对照 `frontend/docs/mockups/子功能-对话演示气泡-语法纠错场景.jpg`。

## §1 主链路：点击「文A」看到译文（US1-AC1/AC2）

1. 发送一句中式英语（如 `good good study.`）触发纠错气泡
2. 点击功能行「文A」
3. **期望**：
   - 译文区出现在**功能行正下方、纠错讲解上方**（上下虚线分隔）——不是讲解之后
   - 等待期间显示加载中表现，**不出现「暂无翻译」**
   - 5 秒内呈现纯中文译文（如「好好学习。」），无解释、无引号、无前缀
   - 讲解内容、✅正确句、操作栏位置不变

## §2 重复查看零等待（US3 / FR-005）

1. §1 成功后，点击「文A」收起，再点击展开
2. **期望**：译文立即显示，无加载态、无网络请求（DevTools Network 面板无新 /api/runs/wait）
3. 收起后气泡其余部分（原句行/功能行）布局不变

## §3 失败反馈与重试（US2 / FR-003）

1. 停掉后端（或 DevTools 断网），点击一条**未取过译文**消息的「文A」
2. **期望**：翻译区行内出现「翻译获取失败，请重试」类文案；无弹窗、无跳转；气泡其余功能（AI 发音、跟读、复制）可正常点击
3. 恢复后端，再次点击「文A」
4. **期望**：重新发起请求并成功展示译文

## §4 加载防重（Edge Case 1）

1. 后端响应缓慢时（或临时限流），连续快速多次点击「文A」
2. **期望**：仅发出一次请求（Network 面板确认），加载态持续到首次请求返回

## §5 零回归（SC-004，全项必过）

1. **AI 发音**：功能行与操作栏两个发音按钮均正常合成播放，失败有轻提示（003 T021 行为不回退）
2. **循环跟读**：面板打开、首次合成有加载反馈、倍速/循环/暂停正常（003 T022 行为不回退）
3. **音频互斥**：跟读面板播放时点气泡发音，前一路停
4. **复制/收藏**：复制成功反馈、收藏占位行为不变
5. **评分条**：语法纠错‼/发音/地道入口行为不变（地道项不渲染为既有决议）
6. **普通消息/新对话/HITL/选场景**：全流程无异常，普通 AI 消息不渲染翻译区

## §6 后端旁路直验（可选，绕过前端）

```powershell
# 直调子图验证 translate 旁路（期望响应含非空 translation 字段）
curl.exe -s -X POST http://127.0.0.1:2024/runs/wait -H "Content-Type: application/json" -d '{\"assistant_id\":\"grammer_tutor\",\"input\":{\"translate_request\":true,\"raw_text\":\"good good study.\"},\"stream_mode\":\"values\"}'
```

- 期望：响应含 `"translation": "<中文译文>"`；`raw_text` 置空串时 `translation` 为 `""`
- 同时验证 TTS 旁路仍正常（tts_request 请求出 raw_audio/tutor_audio），确认 route_entry 三分支互不干扰

## 通过标准

§1~§5 全部符合期望、§6 后端直验通过、全程 DevTools Console 无新增报错 → 004 验收通过。
