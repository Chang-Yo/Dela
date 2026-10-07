// 内置能力的停用清单（设置 › 内置能力）：workspace_settings('tools-disabled')，
// 只存与默认不同的工具名。默认停用 WebFetch 与 WebSearch：联网能力由用户显式开启，
// WebSearch 另需配置搜索 API（kernel/websearch.ts）。本模块不 import registry：
// registry 需要读它做过滤与执行门禁，反向 import 会形成环（dpdm 检查要求 main 零循环）。
import { z } from 'zod';
import { getDatabase } from '../../database';

const KEY = 'tools-disabled';
const disabledListSchema = z.array(z.string().min(1).max(64));

const DEFAULT_DISABLED = new Set(['WebFetch', 'WebSearch']);

/** 读取失败（数据库未就绪、表缺失）按默认停用集处理：工具表组装不因偏好数据失败。 */
export function readDisabledTools(): Set<string> {
  try {
    const row = getDatabase()
      .prepare('SELECT value FROM workspace_settings WHERE key=?')
      .get(KEY) as { value: string } | undefined;
    if (!row) return new Set(DEFAULT_DISABLED);
    const parsed = disabledListSchema.safeParse(JSON.parse(row.value));
    return new Set(parsed.success ? parsed.data : DEFAULT_DISABLED);
  } catch {
    return new Set(DEFAULT_DISABLED);
  }
}

export function writeDisabledTools(names: Iterable<string>): void {
  getDatabase()
    .prepare('INSERT OR REPLACE INTO workspace_settings VALUES (?, ?)')
    .run(KEY, JSON.stringify([...names]));
}

/** 单次读取内的批量判断由调用方持集合完成；此处供执行门禁按名单次查询。 */
export function isToolDisabled(name: string): boolean {
  return readDisabledTools().has(name);
}
