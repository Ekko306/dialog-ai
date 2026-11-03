# Contract: localStorage 本地存储（收藏 + 设置）

**消费方**: `components/pronunciation-popup/favorites-store.ts`、`lib/profile-settings.ts` | **降级**: 隐私模式/抛错 → 模块内存 Map（FR-012），key 前缀统一 `dialog-ai:profile:`

## 1. 收藏 `dialog-ai:profile:favorites`

- 值：`FavoriteItem[]` JSON 数组（data-model §2.4：`{ key, style, en, zh, savedAt }`，`key` 唯一）。
- 解析失败 / 结构不符 → 视为空数组重建，不抛错（FR-013）。
- API（favorites-store.ts，`useSyncExternalStore` 订阅模式，弹窗与"我的"共享同一实例）：

```ts
listFavorites(): FavoriteItem[]                       // savedAt 倒序
isFavorite(key: string): boolean                      // 签名与 003 popup-store 既有消费方兼容
addFavorite(item: Omit<FavoriteItem, "savedAt">): void // 已存在则刷新 savedAt 置顶
removeFavorite(key: string): void
subscribeFavorites(notify: () => void): () => void     // 取消订阅
```

- 003 侧变更：`popup-store.ts` 的 `favorites` Set / `toggleFavorite` 移入本文件；`polish-section.tsx` 的 `toggleFavorite(key)` 调用点改为按收藏态调 `addFavorite({ key, style, en, zh })` / `removeFavorite(key)`（isFavorite 判定不变）。

## 2. 设置 `dialog-ai:profile:settings`

- 值：`ProfileSettings` JSON 对象（data-model §2.5：`{ accent, loopDefault, ttsEnabled }`）。
- 部分字段缺失 → 与默认值合并（渐进兼容）；解析失败 → 全默认。

```ts
getSettings(): ProfileSettings                // 同步读取（含降级内存），懒加载缓存
updateSettings(patch: Partial<ProfileSettings>): void  // 合并写入 + 持久化 + 通知订阅者
subscribeSettings(notify: () => void): () => void
```

## 3. 读取点接线（改动均最小化）

| 设置项 | 读取点 | 行为 |
|---|---|---|
| `accent` | polish-section.tsx AI 朗读（原硬编码 `accent: "american"`） | 改读 `getSettings().accent` |
| `accent` | word-analysis-section.tsx ↻重读 fallback、use-popup-audio `replayLastDemo` fallback | 同上（示范读音默认/兜底源） |
| `accent` | weak-words-section.tsx 单词试听（新代码） | 直接读 |
| `loopDefault` | use-popup-audio.ts `INITIAL_STATE.loop` | 模块初始化读取一次（R5：弹窗内切换不回写） |
| `ttsEnabled` | tool-fallback.aui.tsx audio_choice interrupt 应答处 | `false` 时按 prompt 前缀"是否将润色结果合成为语音"识别并自动 `respondToApproval({ text: "no" })`，不渲染询问 UI（R6） |

## 4. 兼容与迁移

- 无历史版本（项目首个 localStorage 使用点），无迁移需求。
- 写入统一 try/catch；配额/隐私模式失败 → 内存态继续，UI 不报错。
