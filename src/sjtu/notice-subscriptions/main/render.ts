import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { z } from 'zod';
import { validateNoticeUrl } from './parser';

export const renderedPageSchema = z.object({
  url: z.string().transform(validateNoticeUrl),
  html: z.string(),
  fetchedAt: z.iso.datetime(),
});

export async function renderNoticePage(
  rawUrl: string,
  timeoutMs: number,
  runtime: { electronPath: string; workerPath: string },
) {
  const url = validateNoticeUrl(rawUrl);
  if (!isAbsolute(runtime.electronPath) || !isAbsolute(runtime.workerPath))
    throw new Error('渲染运行时路径必须是绝对路径');
  const directory = await mkdtemp(join(tmpdir(), 'dela-notice-render-'));
  const output = join(directory, 'page.json');
  try {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    await new Promise<void>((done, reject) => {
      const child = spawn(
        runtime.electronPath,
        [runtime.workerPath, `--notice-url=${url}`, directory, String(timeoutMs)],
        {
          windowsHide: true,
          env,
          stdio: ['ignore', 'ignore', 'pipe'],
        },
      );
      let diagnostic = '';
      const timer = setTimeout(() => child.kill(), timeoutMs + 5_000);
      child.stderr.on('data', (chunk: Buffer) => {
        diagnostic = (diagnostic + chunk.toString()).slice(-4000);
      });
      child.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once('close', (status) => {
        clearTimeout(timer);
        if (status === 0) done();
        else reject(new Error(`网页渲染失败或超时（${status}）：${diagnostic}`));
      });
    });
    const result = renderedPageSchema.parse(JSON.parse(await readFile(output, 'utf8')));
    return {
      url: result.url,
      body: Buffer.from(result.html, 'utf8'),
      charset: 'utf-8',
      fetchedAt: result.fetchedAt,
    };
  } finally {
    const target = resolve(directory);
    if (
      dirname(target) === resolve(tmpdir()) &&
      target.startsWith(join(resolve(tmpdir()), 'dela-notice-render-'))
    )
      await rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}
