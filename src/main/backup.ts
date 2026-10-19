import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { cp, lstat, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, isAbsolute, join, relative } from 'node:path';
import type { BackupResult } from '../shared/backup';
import { builtinSkillsDirectory } from './agent/skills';
import { cacheDirectoryNames } from './cache';
import { getDatabase } from './database';
import { checkWorkspaceSender } from './ipc';
import { availablePath, storageDirectory } from './storage';

// 数据库走 VACUUM INTO 取一致快照；-wal/-shm 属于当前连接，跟着复制只会得到不自洽的副本。
const databaseFiles = new Set(['dela.db', 'dela.db-wal', 'dela.db-shm', 'dela.db-journal']);

function backupFolderName(now: Date) {
  const pad = (value: number) => String(value).padStart(2, '0');
  const date = [now.getFullYear(), pad(now.getMonth() + 1), pad(now.getDate())].join('-');
  return `Dela 备份 ${date} ${pad(now.getHours())}-${pad(now.getMinutes())}`;
}

/** child 是否就在 parent 里面（含它本身）；同级不算。 */
function isInside(parent: string, child: string) {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * 跳过符号链接，包括 Windows 上的 junction（pnpm 的 node_modules 就是）：实测没有开发者模式时
 * 复刻链接直接 EPERM，会连累整个顶层条目一个文件都复制不出来；而链接指向的内容本就不在这一层。
 */
async function skipLinks(source: string) {
  return !(await lstat(source)).isSymbolicLink();
}

/** 应用数据额外按名字跳过 Chromium 缓存（名单与设置里的「缓存占用」共用，见 `cache.ts`）；工作目录里叫 Cache 的目录可能是用户自己的东西。 */
async function skipCacheAndLinks(source: string) {
  if (cacheDirectoryNames.has(basename(source))) return false;
  return skipLinks(source);
}

/** 返回没复制成功的顶层条目名：界面据此如实告知，不假装备份完整。 */
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
  const workspace = storageDirectory();
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
  getDatabase().exec(`VACUUM INTO '${join(backupData, 'dela.db').replaceAll("'", "''")}'`);

  const skipped: string[] = [];
  for (const entry of await readdir(dataDirectory)) {
    if (databaseFiles.has(entry)) continue;
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
  return { status: 'exported', path: destination, skipped };
}

/** 导出只在条款接受页被调用：拒绝条款的用户也要能先把自己的数据拿走。 */
export function registerBackupIpc() {
  ipcMain.handle('backup:export', (event) => {
    checkWorkspaceSender(event);
    return exportUserData(BrowserWindow.fromWebContents(event.sender));
  });
}
