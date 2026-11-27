import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import type { MigrationContext } from '../types';

type JsonObject = Record<string, unknown>;

const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function sectionOf(parent: JsonObject, key: string): JsonObject {
  if (!isObject(parent[key])) parent[key] = {};
  return parent[key] as JsonObject;
}

/** 文件已被用户写坏时返回 null：不动它，旧数据也留在原处。 */
function readJson(path: string): JsonObject | null {
  if (!existsSync(path)) return {};
  const text = readFileSync(path, 'utf8');
  if (!text.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeJson(path: string, value: JsonObject): void {
  const temporary = `${path}.v13.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, path);
}

/** 旧 id 是 UUID，新 id 取厂商名或域名品牌名，重名加序号；与业务代码的规则相同但各写一份。 */
function brandOf(baseUrl: unknown): string {
  let host = '';
  try {
    host = new URL(String(baseUrl)).hostname;
  } catch {
    return 'custom';
  }
  const labels = host.split('.').filter((label) => label !== 'api' && label !== 'www');
  const brand = (labels.length > 1 ? labels.at(-2) : labels[0]) ?? '';
  return /^[a-z][a-z0-9-]{0,47}$/i.test(brand) ? brand.toLowerCase() : 'custom';
}

/** 内容完全相同的项已在文件里（上次迁移写到一半）就沿用它的键，重跑不会多出一份。 */
function putEntry(section: JsonObject, base: string, entry: JsonObject): string {
  const same = Object.keys(section).find(
    (key) => JSON.stringify(section[key]) === JSON.stringify(entry),
  );
  if (same) return same;
  let key = base;
  for (let suffix = 2; key in section; suffix++) key = `${base}-${suffix}`;
  section[key] = entry;
  return key;
}

/** 返回旧 id 到新 id 的对应，会话表据此改写。 */
function migrateProviders(sealed: unknown, config: JsonObject): Map<string, string> | null {
  if (!isObject(sealed) || !Array.isArray(sealed.providers)) return null;
  const providers = sectionOf(config, 'providers');
  const renamed = new Map<string, string>();
  for (const provider of sealed.providers) {
    if (!isObject(provider) || typeof provider.id !== 'string') continue;
    const modelConfigs = isObject(provider.modelConfigs) ? provider.modelConfigs : {};
    const models = Array.isArray(provider.models) ? provider.models : [];
    const vendor = typeof provider.piProvider === 'string' ? provider.piProvider : null;
    const entry = {
      name: provider.name,
      ...(vendor ? { vendor } : {}),
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      enabled: provider.enabled !== false,
      models: Object.fromEntries(
        models
          .filter((model): model is string => typeof model === 'string')
          .map((model) => [model, isObject(modelConfigs[model]) ? modelConfigs[model] : {}]),
      ),
    };
    renamed.set(provider.id, putEntry(providers, vendor ?? brandOf(provider.baseUrl), entry));
  }
  return renamed;
}

function migrateWebSearch(registry: unknown, config: JsonObject): boolean {
  if (!isObject(registry) || !Array.isArray(registry.providers)) return false;
  const webSearch = sectionOf(config, 'webSearch');
  const services = sectionOf(webSearch, 'services');
  for (const item of registry.providers) {
    if (!isObject(item) || typeof item.id !== 'string') continue;
    const { id, ...entry } = item;
    const key = putEntry(
      services,
      typeof entry.provider === 'string' ? entry.provider : 'custom',
      entry,
    );
    if (id === registry.selectedId && !('selected' in webSearch)) webSearch.selected = key;
  }
  return true;
}

function migrateMcpServers(sealed: unknown, mcp: JsonObject): boolean {
  if (!Array.isArray(sealed)) return false;
  const servers = sectionOf(mcp, 'mcpServers');
  for (const server of sealed) {
    if (!isObject(server) || typeof server.name !== 'string' || server.name in servers) continue;
    servers[server.name] = {
      ...(server.transport === 'http'
        ? { type: 'http', url: server.url, headers: server.headers ?? {} }
        : { command: server.command, args: server.args ?? [], env: server.env ?? {} }),
      ...(server.enabled === false ? { disabled: true } : {}),
    };
  }
  return true;
}

/** 模型服务、联网搜索与 MCP 移到 ~/.dela 下的明文 JSON，供用户和 magpie 等工具直接管理。
 *  不覆盖文件里已有的键，可重复执行；解不开或读不懂的旧数据原样保留。 */
export function v12tov13(db: Database.Database, { userData, home, seal }: MigrationContext): void {
  const directory = join(home, '.dela');
  const configPath = join(directory, 'config.json');
  const mcpPath = join(directory, 'mcp.json');
  const config = readJson(configPath);
  const mcp = readJson(mcpPath);

  const readSealed = (name: string): unknown => {
    const path = join(userData, name);
    if (!existsSync(path)) return undefined;
    try {
      return JSON.parse(seal.decrypt(readFileSync(path)));
    } catch {
      return undefined;
    }
  };
  const row = db
    .prepare("SELECT value FROM workspace_settings WHERE key = 'web-search-api'")
    .get() as { value: string } | undefined;
  let registry: unknown;
  try {
    registry = row ? JSON.parse(row.value) : undefined;
  } catch {
    registry = undefined;
  }

  const renamed = config && migrateProviders(readSealed('llm-providers.bin'), config);
  const providersMoved = renamed !== null;
  const rename = db.prepare('UPDATE sessions SET provider_id = ? WHERE provider_id = ?');
  for (const [from, to] of renamed ?? []) rename.run(to, from);
  const webSearchMoved = config !== null && migrateWebSearch(registry, config);
  const mcpMoved = mcp !== null && migrateMcpServers(readSealed('mcp-servers.bin'), mcp);

  mkdirSync(directory, { recursive: true });
  if (providersMoved || webSearchMoved) writeJson(configPath, config!);
  if (mcpMoved) writeJson(mcpPath, mcp!);
  if (providersMoved) rmSync(join(userData, 'llm-providers.bin'));
  if (mcpMoved) rmSync(join(userData, 'mcp-servers.bin'));
  if (webSearchMoved)
    db.prepare("DELETE FROM workspace_settings WHERE key = 'web-search-api'").run();
}
