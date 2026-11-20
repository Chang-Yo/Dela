import { app, type BrowserWindow, dialog } from 'electron';
import { cp, lstat, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, isAbsolute, join, relative } from 'node:path';
import { builtinSkillsDirectory } from '../../../core/capabilities/skills';
import { configFilePath } from '../../../core/config-files';
import { hostPorts } from '../../../core/ports';
import { availablePath } from '../../workspace';
import type { BackupResult } from '../contract';
import { cacheDirectoryNames } from './cache';

// 数据库走 VACUUM INTO 取一致快照；-wal/-shm 属于当前连接，跟着复制只会得到不自洽的副本。
const databaseFiles = new Set(['dela.db', 'dela.db-wal', 'dela.db-shm', 'dela.db-journal']);
// 备份只保留水源引用；快照和本机密钥不导出，恢复后尝试重新保存。
const skippedDataEntries = new Set([...databaseFiles, 'shuiyuan-snapshots']);

function backupFolderName(now: Date) {
  const pad = (value: number) => String(value).padStart(2, '0');
  const date = [now.getFullYear(), pad(now.getMonth() + 1), pad(now.getDate())].join('-');
  return `Dela 备份 ${date} ${pad(now.getHours())}-${pad(now.getMinutes())}`;
}

function isInside(parent: string, child: string) {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/** 跳过符号链接（含 Windows junction）：无开发者模式时复刻链接会 EPERM，连累整个顶层条目。 */
async function skipLinks(source: string) {
  return !(await lstat(source)).isSymbolicLink();
}

/** 应用数据额外按名字跳过 Chromium 缓存（名单与设置里的「缓存占用」共用，见 `cache.ts`）；工作目录里叫 Cache 的目录可能是用户自己的东西。 */
async function skipCacheAndLinks(source: string) {
  if (cacheDirectoryNames.has(basename(source))) return false;
  return skipLinks(source);
}

export async function exportUserData(window: BrowserWindow | null): Promise<BackupResult> {
  const options = {
    title: '选择备份保存位置',
    buttonLabel: '导出到这里',
    properties: ['openDirectory', 'createDirectory'],
  } satisfies Electron.OpenDialogOptions;
  const picked = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options);
  const parent = picked.filePaths[0];
  if (picked.canceled || !parent) return { status: 'cancelled' };

  const dataDirectory = app.getPath('userData');
  const workspace = hostPorts().paths.storage();
  const skills = builtinSkillsDirectory();
  // 目标落在源目录里面会让导出边写边读自己（复制到一半才发现，还会留下半个文件夹）。
  for (const source of [dataDirectory, workspace, skills]) {
    if (isInside(source, parent)) {
      return { status: 'failed', reason: '不能保存到 Dela 的数据目录里，请另选一个位置' };
    }
  }

  const destination = availablePath(parent, backupFolderName(new Date()), true);
  const backupData = join(destination, '应用数据');
  await mkdir(backupData, { recursive: true });
  hostPorts()
    .database()
    .exec(`VACUUM INTO '${join(backupData, 'dela.db').replaceAll("'", "''")}'`);

  const skipped: string[] = [];
  for (const entry of await readdir(dataDirectory)) {
    if (skippedDataEntries.has(entry)) continue;
    try {
      await cp(join(dataDirectory, entry), join(backupData, entry), {
        recursive: true,
        filter: skipCacheAndLinks,
      });
    } catch {
      skipped.push(entry);
    }
  }

  // 工作目录（默认「文档/Dela」）与 userData 互不相干，各放一层，恢复时不会互相覆盖。
  if (existsSync(workspace)) {
    try {
      await cp(workspace, join(destination, '工作目录'), {
        recursive: true,
        filter: skipLinks,
      });
    } catch {
      skipped.push('工作目录');
    }
  }
  // 用户自己写的 Skill 与内置 Skill 同处 ~/.dela/skills，分不开，整层带走。
  if (existsSync(skills)) {
    try {
      await cp(skills, join(destination, '技能'), { recursive: true, filter: skipLinks });
    } catch {
      skipped.push('技能');
    }
  }
  // 模型服务与 MCP 配置是 ~/.dela 下的明文 JSON，含 API Key，与 Skill 并列放一层。
  for (const name of ['config.json', 'mcp.json'] as const) {
    if (!existsSync(configFilePath(name))) continue;
    try {
      await cp(configFilePath(name), join(destination, '配置', name));
    } catch {
      skipped.push(name);
    }
  }
  return { status: 'exported', path: destination, skipped };
}
