import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, mkdtemp, unlink, rmdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { beforeAll, expect, it } from 'vitest';
import { renderNoticePage } from './render';

const cli = (...args: string[]) =>
  new Promise<{ status: number | null; stdout: string; stderr: string }>((done, reject) => {
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
    child.on('error', reject);
    child.on('close', (status) => done({ status, stdout, stderr }));
  });

beforeAll(async () => {
  const child = spawn(process.execPath, ['experiments/notice-subscriptions/run.ts', '--help'], {
    windowsHide: true,
    stdio: 'ignore',
  });
  const status = await new Promise((done) => child.on('close', done));
  expect(status).toBe(0);
});

it('loads delayed JS in isolation and persists rendered acquisition for refresh', async () => {
  let ids = [1, 2];
  const server = createServer((request, response) => {
    if (request.url === '/data') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify(ids));
      return;
    }
    response.setHeader('content-type', 'text/html; charset=utf-8');
    response.end(`<ul id="notices"></ul><script>
      document.title = [typeof require, typeof process, typeof window.electron].join(',');
      if (document.cookie) document.title = 'session-leaked';
      document.cookie = 'transient=1';
      setTimeout(async () => {
        const ids = await (await fetch('/data')).json();
        document.querySelector('ul').innerHTML = ids.map(id =>
          '<li><a href="/article/' + id + '">Dynamic announcement ' + id + '</a></li>').join('');
      }, 300);
    </script>`);
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test server port');
  const url = `http://127.0.0.1:${address.port}/`;
  const directory = await mkdtemp(join(resolve('.tools/notice-subscriptions'), 'render-test-'));
  const state = join(directory, 'state.json');
  try {
    const staticResult = await cli('preview', url);
    expect(JSON.parse(staticResult.stdout).candidates).toEqual([]);
    const preview = await cli('preview', url, '--render', '--select', '1', '--save', state);
    expect(preview.status, preview.stderr).toBe(0);
    expect(JSON.parse(preview.stdout).title).toBe('undefined,undefined,undefined');
    expect(JSON.parse(preview.stdout).candidates[0].entries).toHaveLength(2);
    expect(JSON.parse(await readFile(state, 'utf8')).acquisition).toBe('rendered');
    ids = [3, 2, 1];
    const changed = await cli('refresh', state);
    expect(changed.status, changed.stderr).toBe(0);
    expect(
      JSON.parse(changed.stdout).newEntries.map((entry: { url: string }) => entry.url),
    ).toEqual([url + 'article/3']);
    const again = await cli('refresh', state);
    expect(again.status, again.stderr).toBe(0);
    expect(JSON.parse(again.stdout).newEntries).toEqual([]);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    await unlink(state).catch(() => {});
    await rmdir(directory);
  }
}, 30_000);

it('reports HTTP errors and timeouts instead of accepting an empty rendered page', async () => {
  const server = createServer((request, response) => {
    if (request.url === '/hang') return;
    response.writeHead(503, { 'content-type': 'text/html' });
    response.end('<h1>Unavailable</h1>');
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test server port');
  const url = `http://127.0.0.1:${address.port}`;
  try {
    await expect(renderNoticePage(url)).rejects.toThrow('HTTP 503');
    await expect(renderNoticePage(url + '/hang', 1000)).rejects.toThrow('超时');
  } finally {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
  }
}, 15_000);
