import { renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import type { MigrationContext } from '../types';

/**
 * MCP 配置从数据库明文移到系统钥匙串加密的 mcp-servers.bin，原有服务器都是 stdio。
 * 新文件只由数据库内容决定，失败重跑直接覆盖；读不出的旧配置原样保留。
 */
export function v11tov12(db: Database.Database, { userData, seal }: MigrationContext): void {
  const row = db.prepare("SELECT value FROM workspace_settings WHERE key = 'mcp-servers'").get() as
    { value: string } | undefined;
  if (!row) return;
  let servers: unknown;
  try {
    servers = JSON.parse(row.value);
  } catch {
    return;
  }
  if (!Array.isArray(servers)) return;
  const migrated = servers.map((server: Record<string, unknown>) => ({
    ...server,
    transport: 'stdio',
  }));
  const path = join(userData, 'mcp-servers.bin');
  const temporary = `${path}.v12.tmp`;
  writeFileSync(temporary, seal.encrypt(JSON.stringify(migrated)));
  renameSync(temporary, path);
  db.prepare("DELETE FROM workspace_settings WHERE key = 'mcp-servers'").run();
}
