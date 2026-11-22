import Database from 'better-sqlite3';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { coreSchema } from '../../core/data/schema';
import { hostPorts, type Schema } from '../../core/ports';
import type { ModuleDefinition } from '../module';

let database: Database.Database | null = null;

/** 宿主自己的表：各方共用的设置键值，同一个键只归一方（scripts/lint-tables.ts）。 */
const hostSchema: Schema = {
  tables: [
    `CREATE TABLE IF NOT EXISTS workspace_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  ],
  migrations: {
    '20261121-rename-storage-directory': (db) => {
      db.exec("UPDATE workspace_settings SET key='storage-directory' WHERE key='directory'");
    },
  },
};

/** 18 起表结构由 schema_migrations 记账；更早的库先经 migrations/ 的旧版过渡。 */
export const SCHEMA_VERSION = 18;

/** 表示这一方的表已按当时的结构建好，此前的迁移不再执行。 */
const baseline = 'baseline';

type Owner = Schema & { owner: string };

/** 按宿主、core 与各模块声明的表结构打开数据库；之后 getDatabase 直接取用。 */
export function openDatabase(modules: ModuleDefinition[]): Database.Database {
  closeDatabase();
  const dir = hostPorts().paths.userData();
  mkdirSync(dir, { recursive: true });
  const db = new Database(join(dir, 'dela.db'));
  try {
    db.pragma('journal_mode = WAL');
    const version = db.pragma('user_version', { simple: true }) as number;
    if (version !== 0 && version !== SCHEMA_VERSION)
      throw new Error('数据库格式不受支持，请使用当前版本创建的数据目录');
    const owners: Owner[] = [
      { owner: 'app', ...hostSchema },
      { owner: 'core', ...coreSchema },
      ...modules.flatMap((module) =>
        module.schema ? [{ owner: module.id, ...module.schema }] : [],
      ),
    ];
    // better-sqlite3 默认开外键检查：建表不依赖模块顺序、迁移重建表不触发级联，都要先关掉。
    db.pragma('foreign_keys = OFF');
    db.transaction(() => {
      applySchemas(db, owners);
      db.pragma(`user_version = ${SCHEMA_VERSION}`);
    })();
    db.pragma('foreign_keys = ON');
  } catch (error) {
    db.close();
    throw error;
  }
  database = db;
  return db;
}

export function getDatabase(): Database.Database {
  if (!database) throw new Error('数据库尚未打开');
  return database;
}

/** 新出现的一方直接建当前结构并跳过已有迁移；其余按日期、同日按 id 补跑迁移。 */
function applySchemas(db: Database.Database, owners: Owner[]): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    module TEXT NOT NULL,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL,
    PRIMARY KEY (module, name)
  )`);
  const applied = db.prepare('SELECT module, name FROM schema_migrations').all() as {
    module: string;
    name: string;
  }[];
  const record = db.prepare(
    'INSERT INTO schema_migrations (module, name, applied_at) VALUES (?, ?, ?)',
  );
  const now = new Date().toISOString();
  const pending: { owner: string; name: string; run: (db: Database.Database) => void }[] = [];
  for (const schema of owners) {
    const migrations = Object.entries(schema.migrations ?? {});
    const done = applied.filter((row) => row.module === schema.owner).map((row) => row.name);
    if (done.length === 0) {
      for (const statement of schema.tables) db.exec(statement);
      for (const name of [baseline, ...migrations.map(([name]) => name)])
        record.run(schema.owner, name, now);
      continue;
    }
    if (done.some((name) => name !== baseline && !migrations.some(([known]) => known === name)))
      throw new Error('数据库由更新版本的 Dela 创建，请升级到最新版本');
    for (const [name, run] of migrations)
      if (!done.includes(name)) pending.push({ owner: schema.owner, name, run });
  }
  const order = (step: { owner: string; name: string }) =>
    `${step.name.slice(0, 8)} ${step.owner} ${step.name}`;
  pending.sort((a, b) => (order(a) < order(b) ? -1 : 1));
  for (const step of pending) {
    step.run(db);
    record.run(step.owner, step.name, now);
  }
}

export function closeDatabase(): void {
  database?.close();
  database = null;
}
