import { chmodSync, existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import type { MigrationContext } from '../types';

const removedSettings = [
  'pi-packages',
  'pi-packages-enabled',
  'pi-packages-registry',
  'prompts-disabled',
  'experimental-features',
  'experimental-shuiyuan',
  'experimental-video-download',
  'capabilities-onboarding-completed',
];

// 只删 Dela 自己的 Pi 目录；用户项目的 .pi/ 与 ~/.pi/agent 归用户和 Pi CLI
const removedPaths = [
  ['components', 'node'],
  ['pi', 'npm'],
  ['pi', 'git'],
  ['pi', 'tmp', 'extensions'],
  ['pi', 'mcp.log'],
];

// git 的对象文件是只读的，Electron 44 的 rmSync 在 Windows 上删不掉只读文件
function removeTree(path: string) {
  if (!existsSync(path)) return;
  if (statSync(path).isDirectory())
    for (const entry of readdirSync(path, { recursive: true, withFileTypes: true }))
      if (entry.isFile()) chmodSync(join(entry.parentPath, entry.name), 0o666);
  rmSync(path, { recursive: true, force: true });
}

export function v9tov10(db: Database.Database, context: MigrationContext): void {
  const remove = db.prepare('DELETE FROM workspace_settings WHERE key = ?');
  for (const key of removedSettings) remove.run(key);
  for (const path of removedPaths) removeTree(join(context.userData, ...path));
}
