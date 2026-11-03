# Contract: LangGraph Threads 数据面（前端聚合只读）

**消费方**: `lib/profile-aggregate.ts` | **代理**: `app/api/[..._path]/route.ts`（透传 GET/POST 到 `LANGGRAPH_API_URL`，自动附 `x-api-key`）| **后端**: 零改动

## 1. 检索最近 threads

```http
POST /api/threads/search
Content-Type: application/json

{ "limit": 30, "offset": 0 }
```

- 响应：`[{ "thread_id": string, "updated_at": string, ... }]`（LangGraph 平台标准响应，按 updated_at 倒序；其余字段忽略）。
- 前端策略：从 `limit=30` 起步，逐线程收集轮次，凑满 50 条有效轮或线程耗尽即停；不足时最多再翻一页（offset 递增）。

## 2. 读取单线程轮次历史

```http
POST /api/threads/{thread_id}/history
Content-Type: application/json

{ "limit": 100 }
```

- 响应：`[{ "values": { ...OverAllState快照 }, "created_at": string, ... }]`（检查点倒序，最新在前；只取 `values` 与 `created_at`）。
- 前端策略：遍历快照，`values.ise_status === "ok"` 且 `ise_check_results` 存在才记为有效轮（data-model §1.1）；单线程默认 `limit=100` 封顶。

## 3. 聚合流程（SC-002：50 条 3s 内）

```text
threads/search(30)
  └─ for each thread: threads/{id}/history(100)   ← 可并发（Promise.all，并发度 ≤ 6）
       └─ 收集 ProfileRound，凑满 50 停止
  └─ 派生：ProfileSummary / WeakWord[]
```

- 任一单线程 history 失败：跳过该线程继续（部分数据可展示）；`threads/search` 失败：整体进入 error 态（FR-014）。

## 4. 错误语义

| HTTP | 前端处理 |
|---|---|
| 404（无线程） | 视为空数据 → empty 态 |
| 4xx/5xx | error 态 + detail 透出 + 重试 |
| 网络失败 | error 态 + 重试（FR-014 禁静默失败） |
