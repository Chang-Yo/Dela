import { copyFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import type { Migration, MigrationContext } from './types';
import { v6tov7 } from './v6tov7';
import { v7tov8 } from './v7tov8';

const migrations: Migration[] = [
  { from: 6, run: v6tov7 },
  { from: 7, run: v7tov8 },
];

/** 每一步改动的文件：迁移前整份备份，任何一步失败都整体还原。 */
const touchedFiles = ['dela.db', 'llm-providers.bin'];

export class UnsupportedDataVersionError extends Error {
  constructor(version: number) {
    super(
      `本机数据来自过旧的 Dela 版本（数据格式 v${version}），无法自动升级。请先备份数据目录，再删除其中的 dela.db 后重新打开。`,
    );
    this.name = 'UnsupportedDataVersionError';
  }
}

/** 把已有数据逐级迁到 target；新安装（没有数据库或 user_version 为 0）不迁移。返回执行的步数。 */
export function runMigrations(context: MigrationContext, target: number): number {
  const path = join(context.userData, 'dela.db');
  if (!existsSync(path)) return 0;
  const db = new Database(path);
  try {
    const version = db.pragma('user_version', { simple: true }) as number;
    if (version === 0 || version === target) return 0;
    if (version > target) throw new Error('数据库由更新版本的 Dela 创建，请升级到最新版本');
    const steps: Migration[] = [];
    for (let from = version; from < target; from++) {
      const step = migrations.find((migration) => migration.from === from);
      if (!step) throw new UnsupportedDataVersionError(version);
      steps.push(step);
    }
    db.pragma('wal_checkpoint(TRUNCATE)');
    const backups = touchedFiles
      .map((name) => join(context.userData, name))
      .filter((file) => existsSync(file))
      .map((file) => {
        copyFileSync(file, `${file}.migrating`);
        return file;
      });
    try {
      for (const step of steps)
        db.transaction(() => {
          step.run(db, context);
          db.pragma(`user_version = ${step.from + 1}`);
        })();
    } catch (error) {
      db.close();
      for (const file of backups) copyFileSync(`${file}.migrating`, file);
      throw error;
    } finally {
      for (const file of backups) rmSync(`${file}.migrating`, { force: true });
    }
    return steps.length;
  } finally {
    if (db.open) db.close();
  }
}
