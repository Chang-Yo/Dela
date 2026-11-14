import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';

const artifacts = resolve('experiments/notice-subscriptions/validation/remediation/render');

async function invoke(...args: string[]) {
  return new Promise<{ status: number | null; stdout: string; stderr: string }>((done, reject) => {
    const child = spawn(
      process.execPath,
      [resolve('.tools/notice-subscriptions/cli.cjs'), ...args],
      {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.once('error', reject);
    child.once('close', (status) => done({ status, stdout, stderr }));
  });
}

it('explicitly retries a static shell with rendering and persists that acquisition across refreshes', async () => {
  const directory = await mkdtemp(
    resolve('.tools/notice-subscriptions/remediation/acquisition-flow-'),
  );
  const statePath = join(directory, 'state.json');
  const outputPath = join(directory, 'preview.json');
  const baseline = [1, 2, 3].map((id) => ({
    title: `显式渲染流程第${id}条独立公告`,
    url: `https://fresh-campus.example/announcement/${id}`,
    publishedAt: '2026-11-10',
  }));
  const fourth = {
    title: '显式渲染流程第4条独立公告',
    url: 'https://fresh-campus.example/announcement/4',
    publishedAt: '2026-11-11',
  };
  let entries = baseline;
  const pages: { sha256: string; count: number }[] = [];
  const server = createServer((_, response) => {
    const rows = entries
      .map(
        (entry) =>
          `<li><a href="${entry.url}">${entry.title}</a><time>${entry.publishedAt}</time></li>`,
      )
      .join('');
    const html = `<html><head><title>独立校园门户</title></head><body><div id="sidebar"><a href="/about">学校概况与院系介绍</a><a href="/services">校园服务办事指南</a></div><main><h2>通知公告</h2><ul id="announcements"></ul></main><script>setTimeout(()=>document.getElementById('announcements').innerHTML=${JSON.stringify(rows)},3000)</script></body></html>`;
    pages.push({ sha256: createHash('sha256').update(html).digest('hex'), count: entries.length });
    response.setHeader('content-type', 'text/html; charset=utf-8');
    response.end(html);
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Local server unavailable');
  const origin = `http://127.0.0.1:${address.port}/`;
  const commands: unknown[] = [];
  const startedAt = new Date().toISOString();
  const sourcePaths = [
    'experiments/notice-subscriptions/render-worker.ts',
    'experiments/notice-subscriptions/cli.ts',
    '.tools/notice-subscriptions/render-worker.cjs',
    '.tools/notice-subscriptions/cli.cjs',
    'experiments/notice-subscriptions/validation/remediation/render/acquisition-flow.test.ts',
  ];
  const hashes = Object.fromEntries(
    await Promise.all(
      sourcePaths.map(async (path) => [
        path,
        createHash('sha256')
          .update(await readFile(path))
          .digest('hex'),
      ]),
    ),
  );
  let passed = false;
  try {
    const staticPreview = await invoke('preview', origin, '--sample', baseline[0]!.title);
    commands.push({ step: 'http-preview', ...staticPreview });
    expect(staticPreview.status, staticPreview.stderr).toBe(0);
    const staticOutput = JSON.parse(staticPreview.stdout);
    expect(staticOutput.acquisition).toBe('http');
    expect(staticOutput.status).toBe('unsupported');
    expect(staticOutput.candidates).toEqual([]);
    expect(await readdir(directory)).toEqual([]);

    const renderedPreview = await invoke(
      'preview',
      origin,
      '--render',
      '--sample',
      baseline[0]!.title,
      '--select',
      '1',
      '--save',
      statePath,
      '--out',
      outputPath,
    );
    commands.push({ step: 'explicit-render-preview', ...renderedPreview });
    expect(renderedPreview.status, renderedPreview.stderr).toBe(0);
    const preview = JSON.parse(await readFile(outputPath, 'utf8'));
    const initialState = JSON.parse(await readFile(statePath, 'utf8'));
    commands.push({ step: 'saved-preview', output: preview, state: initialState });
    expect(preview.acquisition).toBe('rendered');
    expect(initialState.acquisition).toBe('rendered');
    expect(
      preview.candidates[0].entries.map(
        ({ title, url, publishedAt }: { title: string; url: string; publishedAt: string }) => ({
          title,
          url,
          publishedAt,
        }),
      ),
    ).toEqual(baseline);

    entries = [fourth, ...baseline];
    const refresh = await invoke('refresh', statePath);
    commands.push({ step: 'refresh-with-new-entry', ...refresh });
    expect(refresh.status, refresh.stderr).toBe(0);
    const refreshed = JSON.parse(refresh.stdout);
    expect(
      refreshed.newEntries.map(
        ({ title, url, publishedAt }: { title: string; url: string; publishedAt: string }) => ({
          title,
          url,
          publishedAt,
        }),
      ),
    ).toEqual([fourth]);
    expect(refreshed.entries).toBe(4);
    expect(JSON.parse(await readFile(statePath, 'utf8')).acquisition).toBe('rendered');

    const repeated = await invoke('refresh', statePath);
    commands.push({ step: 'repeat-refresh', ...repeated });
    expect(repeated.status, repeated.stderr).toBe(0);
    expect(JSON.parse(repeated.stdout).newEntries).toEqual([]);
    expect(JSON.parse(repeated.stdout).entries).toBe(4);
    const after = Object.fromEntries(
      await Promise.all(
        sourcePaths.map(async (path) => [
          path,
          createHash('sha256')
            .update(await readFile(path))
            .digest('hex'),
        ]),
      ),
    );
    expect(after).toEqual(hashes);
    passed = true;
  } finally {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    await writeFile(
      join(artifacts, 'acquisition-flow-evidence.json'),
      JSON.stringify(
        {
          startedAt,
          completedAt: new Date().toISOString(),
          passed,
          scope:
            'Explicit CLI retry with --render; no automatic fallback or application integration.',
          directory,
          hashes,
          pages,
          commands,
        },
        null,
        2,
      ) + '\n',
    );
  }
}, 60_000);
