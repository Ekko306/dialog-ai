/**
 * localStorage 安全封装（contracts/local-storage.md §0/§4，research R7）：
 * - 读写均 try/catch，隐私模式/禁用存储/配额失败 → 降级模块内存 Map（FR-012，
 *   仅当前会话有效），UI 无感知不报错；
 * - JSON 解析失败返回 null（视为损坏按空处理，FR-013 禁白屏）；
 * - key 前缀统一 `dialog-ai:profile:`（由调用方拼接）；
 * - 项目首个 localStorage 使用点（全仓 0 既有引用），SSR/Node 环境下
 *   window 访问异常同样被 catch 吸收为内存态，安全。
 */

const memoryFallback = new Map<string, string>();

export function safeGetItem(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return memoryFallback.get(key) ?? null;
  }
}

export function safeSetItem(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    memoryFallback.set(key, value);
  }
}

/** JSON 读取：原始值不存在 → null；解析失败（损坏）→ null（按空处理不抛错） */
export function safeReadJson(key: string): unknown | null {
  const raw = safeGetItem(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export function safeWriteJson(key: string, value: unknown): void {
  safeSetItem(key, JSON.stringify(value));
}
