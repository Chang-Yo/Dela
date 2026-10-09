import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { getDatabase } from './database';
import { canvasFilePath, getSource } from './canvas/api';
import { createWorkspaceEntry, workspaceFilePath } from './workspace/api';
import {
  availablePath,
  readOfficeExportLink,
  writeOfficeExportLink,
  type OfficeExportLink,
} from './storage';
import { classifyOfficeFile } from './resource-parse';
import { resourceRefSchema, type ResourceRef } from '../shared/resources';
import type { OfficeExportProgress } from '../shared/api';

// 我的资料下集中存放导出 PDF 的固定文件夹；id 记在 settings，重命名后仍能找回。
const EXPORT_FOLDER_NAME = '预览导出';
const EXPORT_FOLDER_SETTING = 'preview-export-folder';
const EXPORT_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Windows PowerShell 5.1 兼容脚本（不用 PS7 独有语法）：
 * COM 调 PowerPoint 后台打开（只读、无窗口）另存为 PDF，退出码 0 表示成功。
 * 输入/输出路径经环境变量传入，不拼接进命令文本。
 */
const powerShellScript = [
  "$ErrorActionPreference = 'Stop'",
  '$code = 1',
  "$message = ''",
  '$app = $null',
  'try {',
  '  $app = New-Object -ComObject PowerPoint.Application',
  '  $presentation = $app.Presentations.Open($env:DELA_PPTX_INPUT, -1, 0, 0)',
  '  try {',
  '    $presentation.SaveAs($env:DELA_PPTX_OUTPUT, 32)',
  '    $code = 0',
  '  } finally {',
  '    $presentation.Close()',
  '  }',
  '} catch {',
  '  $message = $_.Exception.Message',
  '} finally {',
  '  if ($null -ne $app) {',
  '    $app.Quit()',
  '  }',
  '}',
  'if ($code -ne 0) {',
  '  [Console]::Error.WriteLine($message)',
  '}',
  'exit $code',
].join('\n');

interface OfficeSource {
  kind: 'canvas' | 'workspace';
  id: string;
  path: string;
  /** 源文件版本：Canvas 用 updatedAt，本地文件用 mtime-size。 */
  version: string;
  title: string;
}

async function resolveSource(ref: ResourceRef): Promise<OfficeSource> {
  if (ref.type === 'canvas') {
    const source = getSource(ref.id);
    return {
      kind: 'canvas',
      id: ref.id,
      path: await canvasFilePath(ref.id),
      version: source.updatedAt ?? '',
      title: source.title,
    };
  }
  if (ref.type !== 'workspace') throw new Error('仅支持资料文件与我的资料条目');
  const path = await workspaceFilePath(ref.id);
  const stats = statSync(path);
  return {
    kind: 'workspace',
    id: ref.id,
    path,
    version: `${stats.mtimeMs}-${stats.size}`,
    title: basename(path),
  };
}

function convertToPdf(input: string, output: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const encoded = Buffer.from(powerShellScript, 'utf16le').toString('base64');
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      {
        env: { ...process.env, DELA_PPTX_INPUT: input, DELA_PPTX_OUTPUT: output },
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'pipe'],
      },
    );
    let stderr = '';
    let settled = false;
    const finish = (error: Error | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(() => {
      // 超时必须连进程树一起杀掉：挂起的 PowerShell 与其拉起的 PowerPoint 会常驻后台。
      if (child.pid) {
        spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore',
        });
      }
      child.kill();
      finish(new Error('导出超时：PowerPoint 长时间无响应，请稍后重试'));
    }, EXPORT_TIMEOUT_MS);
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', (error) => finish(new Error(`无法启动 PowerShell：${error.message}`)));
    child.once('close', (code) => {
      if (code !== 0) {
        finish(new Error(friendlyPowerShellError(stderr, code)));
        return;
      }
      finish(existsSync(output) ? null : new Error('导出没有生成 PDF 文件，请重试'));
    });
  });
}

function friendlyPowerShellError(stderr: string, code: number | null): string {
  if (/80040154|class not registered|没有注册类/i.test(stderr))
    return '未检测到 PowerPoint：请先安装 Microsoft PowerPoint，或改用「下载文件」在外部打开';
  const detail = stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);
  return detail ? `PowerPoint 导出失败：${detail}` : `PowerPoint 导出失败（退出码 ${code}）`;
}

function ensureExportFolder(): { id: string; path: string } {
  const db = getDatabase();
  const row = (id: string) =>
    db
      .prepare("SELECT id, local_path AS path FROM workspace_entries WHERE id=? AND kind='folder'")
      .get(id) as { id: string; path: string | null } | undefined;
  const usable = (item: { id: string; path: string | null } | undefined) => {
    if (item?.path && existsSync(item.path)) return { id: item.id, path: item.path };
    return undefined;
  };
  const stored = db
    .prepare('SELECT value FROM workspace_settings WHERE key=?')
    .get(EXPORT_FOLDER_SETTING) as { value: string } | undefined;
  // 设置键优先（文件夹被重命名后仍可找回），缺失时按名称兜底，最后才新建。
  const folder =
    usable(stored ? row(stored.value) : undefined) ??
    usable(
      db
        .prepare(
          "SELECT id, local_path AS path FROM workspace_entries WHERE parent_id IS NULL AND name=? AND kind='folder' LIMIT 1",
        )
        .get(EXPORT_FOLDER_NAME) as { id: string; path: string | null } | undefined,
    ) ??
    usable(
      row(createWorkspaceEntry({ parentId: null, name: EXPORT_FOLDER_NAME, kind: 'folder' }).id),
    );
  if (!folder) throw new Error('无法创建「预览导出」文件夹');
  db.prepare('INSERT OR REPLACE INTO workspace_settings VALUES (?, ?)').run(
    EXPORT_FOLDER_SETTING,
    folder.id,
  );
  return folder;
}

function registerExportEntry(
  folderId: string,
  previousEntryId: string | undefined,
  path: string,
): string {
  const db = getDatabase();
  const now = new Date().toISOString();
  if (
    previousEntryId &&
    db.prepare('SELECT 1 FROM workspace_entries WHERE id=?').get(previousEntryId)
  ) {
    // local_path 必须与落盘路径同步：用户可能已重命名/移动过该条目。
    db.prepare('UPDATE workspace_entries SET name=?, local_path=?, updated_at=? WHERE id=?').run(
      basename(path),
      path,
      now,
      previousEntryId,
    );
    return previousEntryId;
  }
  const id = randomUUID();
  // 列名显式写出：这张表的列随 schema 版本增删过，位置参数会静默错位。
  db.prepare(
    `INSERT INTO workspace_entries (id, parent_id, name, kind, source_id, local_path, updated_at)
     VALUES (?, ?, ?, 'imported', NULL, ?, ?)`,
  ).run(id, folderId, basename(path), path, now);
  return id;
}

// PowerPoint COM 是单实例服务器：并发转换会互相打断（先完成方的 Quit 终止共享实例），
// 用 Promise 链把实际转换串行化，同一时刻只跑一个 PowerPoint 任务。
let conversionQueue: Promise<unknown> = Promise.resolve();
function enqueueConversion(run: () => Promise<void>): Promise<void> {
  const work = conversionQueue.then(run, run);
  conversionQueue = work.catch(() => {});
  return work;
}

async function runOfficeExport(
  ref: ResourceRef,
  onProgress: (progress: OfficeExportProgress) => void,
): Promise<void> {
  onProgress({ phase: 'preparing' });
  const source = await resolveSource(ref);
  if ((await classifyOfficeFile(source.path)) !== 'pptx')
    throw new Error('仅支持导出 PowerPoint 演示文稿（pptx）');
  const folder = ensureExportFolder();
  const pdfName = `${basename(source.title, extname(source.title))}.pdf`;
  const previous = readOfficeExportLink(source.kind, source.id);
  // 重复导出覆盖同一文件（避免产生「A (2).pdf」）；首次落盘用 availablePath 防撞名。
  const target =
    previous && existsSync(previous.path) ? previous.path : availablePath(folder.path, pdfName);
  // 先写到临时名再改回目标名：转换失败时不破坏上一次的导出。
  const temporary = `${target}.${randomUUID()}.part.pdf`;
  try {
    await enqueueConversion(async () => {
      onProgress({ phase: 'converting' });
      // PowerPoint 在保存末段才写输出；轮询临时文件让用户看到「正在写入」的进展。
      const poll = setInterval(() => {
        try {
          const stats = statSync(temporary);
          if (stats.isFile()) onProgress({ phase: 'writing', bytes: stats.size });
        } catch {
          /* 输出尚未生成 */
        }
      }, 1500);
      try {
        await convertToPdf(source.path, temporary);
      } finally {
        clearInterval(poll);
      }
    });
    renameSync(temporary, target);
  } catch (error) {
    try {
      if (existsSync(temporary)) unlinkSync(temporary);
    } catch {
      /* 清理尽力而为 */
    }
    throw error;
  }
  const entryId = registerExportEntry(folder.id, previous?.entryId, target);
  const link: OfficeExportLink = {
    entryId,
    path: target,
    version: source.version,
    exportedAt: new Date().toISOString(),
  };
  writeOfficeExportLink(source.kind, source.id, link);
}

// 同一文件并发导出只跑一次（对齐 Canvas 下载的去重模式）。
const inFlight = new Map<string, Promise<void>>();

export function exportOfficePdf(
  ref: unknown,
  onProgress?: (progress: OfficeExportProgress) => void,
): Promise<void> {
  const parsed = resourceRefSchema.parse(ref);
  if (parsed.type !== 'canvas' && parsed.type !== 'workspace')
    throw new Error('仅支持资料文件与我的资料条目');
  const key = `${parsed.type}:${parsed.id}`;
  const existing = inFlight.get(key);
  if (existing) return existing;
  const work = runOfficeExport(parsed, onProgress ?? (() => {})).finally(() =>
    inFlight.delete(key),
  );
  inFlight.set(key, work);
  return work;
}
