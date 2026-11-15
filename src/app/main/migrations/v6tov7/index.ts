import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import type { MigrationContext } from '../types';

interface V6Provider {
  id: string;
  model?: unknown;
  modelConfigs?: Record<string, { effort?: unknown; effortLevels?: unknown }>;
  [key: string]: unknown;
}

/**
 * 模型选择从全局改成按会话：sessions 加 provider_id/model/effort，旧会话回填 v6 使用中的提供商与模型；
 * llm-providers.bin 去掉 activeId 与提供商上的 model，提供商改为 enabled 开关（全部启用）。
 */
export function v6tov7(db: Database.Database, { userData, seal }: MigrationContext): void {
  db.exec(`ALTER TABLE sessions ADD COLUMN provider_id TEXT;
    ALTER TABLE sessions ADD COLUMN model TEXT;
    ALTER TABLE sessions ADD COLUMN effort TEXT;`);
  const path = join(userData, 'llm-providers.bin');
  if (!existsSync(path)) return;
  let config: { providers?: V6Provider[]; activeId?: unknown };
  try {
    config = JSON.parse(seal.decrypt(readFileSync(path)));
  } catch {
    // 本机解不开的配置留给设置页重新配置；会话列保持 NULL，按「沿用最近会话」处理。
    return;
  }
  const providers = Array.isArray(config.providers) ? config.providers : [];
  if (!providers.some((provider) => 'model' in provider) && !('activeId' in config)) return;
  const active = providers.find(({ id }) => id === config.activeId);
  if (active && typeof active.model === 'string') {
    const effort = active.modelConfigs?.[active.model]?.effort;
    db.prepare('UPDATE sessions SET provider_id=?, model=?, effort=?').run(
      active.id,
      active.model,
      typeof effort === 'string' ? effort : null,
    );
  }
  const next = {
    providers: providers.map(({ model: _model, ...provider }) => ({ ...provider, enabled: true })),
  };
  const temporary = `${path}.v7.tmp`;
  writeFileSync(temporary, seal.encrypt(JSON.stringify(next)));
  renameSync(temporary, path);
}
