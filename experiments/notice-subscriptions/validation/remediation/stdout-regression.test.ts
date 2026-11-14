import { mkdtemp, readFile, rmdir, unlink, writeFile } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { beforeAll, expect, it } from 'vitest';

const cliPath = resolve('.tools/notice-subscriptions/cli.cjs');

beforeAll(() => {
  const built = spawnSync(process.execPath, ['experiments/notice-subscriptions/run.ts', '--help'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  expect(built.status, built.stderr).toBe(0);
});

it('preserves the baseline and retries unseen entries after the output pipe closes', async () => {
  const directory = await mkdtemp(resolve('.tools/notice-subscriptions/stdout-review-'));
  const pagePath = join(directory, 'page.html');
  const statePath = join(directory, 'state.json');
  const html = (count: number) =>
    `<ul id="notices">${Array.from({ length: count }, (_, index) => {
      const id = index + 1;
      return `<li><a href="/notice/${id}">学院公告第 ${id} 条</a></li>`;
    }).join('')}</ul>`;
  const invoke = (...args: string[]) =>
    spawnSync(process.execPath, [cliPath, ...args], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10_000,
    });
  try {
    await writeFile(pagePath, html(2));
    const baseline = invoke(
      'preview',
      'https://unseen.example/',
      '--file',
      pagePath,
      '--select',
      '1',
      '--save',
      statePath,
    );
    expect(baseline.status, baseline.stderr).toBe(0);
    const before = await readFile(statePath, 'utf8');
    await writeFile(pagePath, html(1000));
    const child = spawn(process.execPath, [cliPath, 'refresh', statePath, '--file', pagePath], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stdout.once('data', () => child.stdout.destroy());
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    const status = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
    expect(status).toBe(1);
    expect(stderr).toContain('EPIPE');
    expect(await readFile(statePath, 'utf8')).toBe(before);
    const retry = invoke('refresh', statePath, '--file', pagePath);
    expect(retry.status, retry.stderr).toBe(0);
    expect(JSON.parse(retry.stdout).newEntries).toHaveLength(998);
  } finally {
    await Promise.all([pagePath, statePath].map((path) => unlink(path).catch(() => {})));
    await rmdir(directory);
  }
});
