import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, unlink, writeFile, rmdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { beforeAll, expect, it } from 'vitest';

beforeAll(() => {
  const build = spawnSync(process.execPath, ['experiments/notice-subscriptions/run.ts', '--help'], {
    encoding: 'utf8',
    timeout: 30_000,
    windowsHide: true,
  });
  expect(build.status, build.stderr).toBe(0);
});

it('previews, explicitly saves, refreshes once, and preserves state on parsing failure', async () => {
  const directory = await mkdtemp(join(resolve('.tools/notice-subscriptions'), 'cli-test-'));
  const htmlPath = join(directory, 'page.html');
  const statePath = join(directory, 'state.json');
  const snapshotPath = join(directory, 'snapshot.html');
  const call = (...args: string[]) =>
    spawnSync(process.execPath, [resolve('.tools/notice-subscriptions/cli.cjs'), ...args], {
      encoding: 'utf8',
      timeout: 10_000,
      windowsHide: true,
    });
  const html = (ids: number[]) =>
    '<ul id="notices">' +
    ids.map((id) => `<li><a href="/notice/${id}">学院公告第 ${id} 条</a></li>`).join('') +
    '</ul>';
  try {
    await writeFile(htmlPath, html([1, 2]));
    const rejected = call(
      'preview',
      'https://unknown.example/',
      '--file',
      htmlPath,
      '--save',
      statePath,
    );
    expect(rejected.status).toBe(1);
    await expect(readFile(statePath)).rejects.toThrow();
    const preview = call(
      'preview',
      'https://unknown.example/',
      '--file',
      htmlPath,
      '--snapshot',
      snapshotPath,
      '--select',
      '1',
      '--save',
      statePath,
    );
    expect(preview.status, preview.stderr).toBe(0);
    expect(await readFile(snapshotPath, 'utf8')).toBe(html([1, 2]));
    expect(JSON.parse(preview.stdout).candidates[0].entries).toHaveLength(2);
    const unchanged = call('refresh', statePath, '--file', htmlPath);
    expect(unchanged.status, unchanged.stderr).toBe(0);
    expect(JSON.parse(unchanged.stdout).newEntries).toEqual([]);
    await writeFile(htmlPath, html([3, 2, 1]));
    const changed = call('refresh', statePath, '--file', htmlPath);
    expect(changed.status, changed.stderr).toBe(0);
    expect(JSON.parse(changed.stdout).newEntries.map((entry: { id: string }) => entry.id)).toEqual([
      'https://unknown.example/notice/3',
    ]);
    const again = call('refresh', statePath, '--file', htmlPath);
    expect(again.status, again.stderr).toBe(0);
    expect(JSON.parse(again.stdout).newEntries).toEqual([]);
    const before = await readFile(statePath, 'utf8');
    await writeFile(htmlPath, '<h1>登录后才能继续</h1>');
    const failed = call('refresh', statePath, '--file', htmlPath);
    expect(failed.status).toBe(1);
    expect(failed.stderr).toContain('失配');
    expect(await readFile(statePath, 'utf8')).toBe(before);
  } finally {
    for (const path of [htmlPath, statePath, snapshotPath]) await unlink(path).catch(() => {});
    await rmdir(directory);
  }
});
