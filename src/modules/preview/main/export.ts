import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { resourceAddressSchema, resourceResolver } from '../../../core/capabilities/resources';
import type { ResourceAddress } from '../../../core/protocol/workbench';
import { availablePath, workspaceRootDirectory } from '../../workspace';
import { readOfficeExportLink, writeOfficeExportLink, type OfficeExportLink } from './links';
import { classifyOfficeFile } from './parse';
import type { OfficeExportProgress } from '../../workspace/contract';

// 资料根目录下集中存放导出 PDF 的文件夹；和其他文件一样按路径识别，改名后下次导出会重建。
const EXPORT_FOLDER_NAME = '预览导出';
const EXPORT_TIMEOUT_MS = 5 * 60 * 1000;

// PowerShell 5.1 兼容（不用 PS7 语法）；路径经环境变量传入，不拼接进命令文本。
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

function exportFolder(): string {
  const path = join(workspaceRootDirectory(), EXPORT_FOLDER_NAME);
  mkdirSync(path, { recursive: true });
  return path;
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
  ref: ResourceAddress,
  sourcePath: () => Promise<string>,
  onProgress: (progress: OfficeExportProgress) => void,
): Promise<void> {
  onProgress({ phase: 'preparing' });
  const path = await sourcePath();
  if ((await classifyOfficeFile(path)) !== 'pptx')
    throw new Error('仅支持导出 PowerPoint 演示文稿（pptx）');
  const stats = statSync(path);
  const pdfName = `${basename(path, extname(path))}.pdf`;
  const previous = readOfficeExportLink(ref.type, String(ref.id));
  const target =
    previous && existsSync(previous.path) ? previous.path : availablePath(exportFolder(), pdfName);
  // 先写到临时名再改回目标名：转换失败时不破坏上一次的导出。
  const temporary = `${target}.${randomUUID()}.part.pdf`;
  try {
    await enqueueConversion(async () => {
      onProgress({ phase: 'converting' });
      const poll = setInterval(() => {
        try {
          const stats = statSync(temporary);
          if (stats.isFile()) onProgress({ phase: 'writing', bytes: stats.size });
        } catch {
          /* 输出尚未生成 */
        }
      }, 1500);
      try {
        await convertToPdf(path, temporary);
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
  const link: OfficeExportLink = {
    path: target,
    version: `${stats.mtimeMs}-${stats.size}`,
    exportedAt: new Date().toISOString(),
  };
  writeOfficeExportLink(ref.type, String(ref.id), link);
}

const inFlight = new Map<string, Promise<void>>();

export function exportOfficePdf(
  ref: unknown,
  onProgress?: (progress: OfficeExportProgress) => void,
): Promise<void> {
  if (process.platform !== 'win32')
    return Promise.reject(new Error('当前平台暂不支持 PPTX 转 PDF，请用外部应用打开原文件。'));
  const parsed = resourceAddressSchema.parse(ref);
  const { path } = resourceResolver(parsed.type);
  if (!path || !('id' in parsed)) throw new Error('仅支持资料文件与我的资料条目');
  const key = `${parsed.type}:${String(parsed.id)}`;
  const existing = inFlight.get(key);
  if (existing) return existing;
  const work = runOfficeExport(parsed, () => path(parsed), onProgress ?? (() => {})).finally(() =>
    inFlight.delete(key),
  );
  inFlight.set(key, work);
  return work;
}
