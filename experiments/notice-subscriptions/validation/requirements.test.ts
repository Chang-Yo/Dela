import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rmdir, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeAll, beforeEach, expect, it } from 'vitest';

const origin = 'https://future-campus.example/notice';
const cliPath = resolve('.tools/notice-subscriptions/cli.cjs');
let directory: string;
let pagePath: string;
let statePath: string;
const createdPaths = new Set<string>();

interface Entry {
  id: string;
  title: string;
  url: string;
  publishedAt: string | null;
}

function invoke(...args: string[]) {
  return new Promise<{ status: number; stdout: string; stderr: string }>((resolveResult) => {
    execFile(
      process.execPath,
      [cliPath, ...args],
      { encoding: 'utf8', timeout: 10_000, windowsHide: true },
      (error, stdout, stderr) => {
        resolveResult({ status: error ? Number(error.code) || 1 : 0, stdout, stderr });
      },
    );
  });
}

function page(
  records: { id: number; title?: string; href?: string; date?: string | null }[],
  heading = '本科生通知公告',
  listId = 'notices',
) {
  return (
    `<html><head><meta charset="utf-8"></head><body><section><h2>${heading}</h2><ul id="${listId}">` +
    records
      .map(
        (record) =>
          `<li><a href="${record.href ?? `/notice/${record.id}`}">${record.title ?? `学院正式公告第 ${record.id} 条`}</a>` +
          (record.date === null ? '' : `<time>${record.date ?? '2026-11-01'}</time>`) +
          '</li>',
      )
      .join('') +
    '</ul></section></body></html>'
  );
}

async function writeFixture(html: string) {
  await writeFile(pagePath, html);
}

async function saveBaseline(url = origin, html = page([{ id: 1 }, { id: 2 }, { id: 3 }])) {
  await writeFixture(html);
  const saved = await invoke(
    'preview',
    url,
    '--file',
    pagePath,
    '--select',
    '1',
    '--save',
    statePath,
  );
  expect(saved.status, saved.stderr).toBe(0);
  return saved;
}

async function refresh() {
  const result = await invoke('refresh', statePath, '--file', pagePath);
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout) as { newEntries: Entry[]; entries: number; baseline: boolean };
}

beforeAll(async () => {
  await new Promise<void>((resolveBuild, rejectBuild) => {
    execFile(
      process.execPath,
      ['experiments/notice-subscriptions/run.ts', '--help'],
      { encoding: 'utf8', timeout: 30_000, windowsHide: true },
      (error, _stdout, stderr) => (error ? rejectBuild(new Error(stderr)) : resolveBuild()),
    );
  });
});

beforeEach(async () => {
  directory = await mkdtemp(resolve('.tools/notice-subscriptions/requirements-'));
  pagePath = join(directory, 'page.html');
  statePath = join(directory, 'state.json');
  createdPaths.clear();
  createdPaths.add(pagePath);
  createdPaths.add(statePath);
});

afterEach(async () => {
  for (const path of createdPaths) await unlink(path).catch(() => {});
  await rmdir(directory);
});

it('R01 previews independent columns without creating subscription state', async () => {
  await writeFixture(
    page([{ id: 1 }, { id: 2 }, { id: 3 }]) +
      page([{ id: 41 }, { id: 42 }, { id: 43 }], '研究生通知公告', 'graduate'),
  );
  const result = await invoke('preview', origin, '--file', pagePath);
  expect(result.status, result.stderr).toBe(0);
  const candidates = JSON.parse(result.stdout).candidates as { entries: Entry[] }[];
  expect(
    candidates.some((candidate) => candidate.entries.some((entry) => entry.url.endsWith('/1'))),
  ).toBe(true);
  expect(
    candidates.some((candidate) => candidate.entries.some((entry) => entry.url.endsWith('/41'))),
  ).toBe(true);
  await expect(readFile(statePath)).rejects.toThrow();
});

it('R02 requires a valid explicit selection before writing state', async () => {
  await writeFixture(page([{ id: 1 }, { id: 2 }, { id: 3 }]));
  for (const selection of [[], ['--select', '0'], ['--select', '99'], ['--select', '1.5']]) {
    const result = await invoke(
      'preview',
      origin,
      '--file',
      pagePath,
      ...selection,
      '--save',
      statePath,
    );
    expect(result.status).toBe(1);
    await expect(readFile(statePath)).rejects.toThrow();
  }
});

it('R03 establishes a quiet baseline across a new process', async () => {
  await saveBaseline();
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  expect(state.seenIds).toEqual(
    [1, 2, 3].map((id) => `https://future-campus.example/notice/${id}`),
  );
  expect((await refresh()).newEntries).toEqual([]);
});

it('R04 emits an older-dated newly discovered URL exactly once', async () => {
  await saveBaseline();
  await writeFixture(page([{ id: 4, date: '2020-01-01' }, { id: 1 }, { id: 2 }]));
  expect((await refresh()).newEntries.map((entry) => entry.url)).toEqual([
    'https://future-campus.example/notice/4',
  ]);
  expect((await refresh()).newEntries).toEqual([]);
});

it('R05 ignores ordering, pinning and title edits for existing identities', async () => {
  await saveBaseline();
  await writeFixture(page([{ id: 3, title: '置顶修改后的第三条正式通知' }, { id: 2 }, { id: 1 }]));
  expect((await refresh()).newEntries).toEqual([]);
});

it('R06 retains previously seen entries after removal and reappearance', async () => {
  await saveBaseline();
  await writeFixture(page([{ id: 2 }, { id: 3 }]));
  expect((await refresh()).newEntries).toEqual([]);
  await writeFixture(page([{ id: 1 }, { id: 2 }, { id: 3 }]));
  expect((await refresh()).newEntries).toEqual([]);
});

it('R07 normalizes article fragments without emitting duplicates', async () => {
  await saveBaseline();
  await writeFixture(page([{ id: 1, href: '/notice/1#appendix' }, { id: 2 }, { id: 3 }]));
  expect((await refresh()).newEntries).toEqual([]);
});

it('R08 preserves article query parameters as distinct identities', async () => {
  await saveBaseline();
  await writeFixture(page([{ id: 1, href: '/notice/1?article=2' }, { id: 2 }, { id: 3 }]));
  expect((await refresh()).newEntries.map((entry) => entry.url)).toEqual([
    'https://future-campus.example/notice/1?article=2',
  ]);
});

it('R09 deduplicates repeated links within one visible list', async () => {
  await saveBaseline();
  await writeFixture(page([{ id: 4 }, { id: 4 }, { id: 1 }, { id: 2 }]));
  expect((await refresh()).newEntries.map((entry) => entry.url)).toEqual([
    'https://future-campus.example/notice/4',
  ]);
});

it('R10 keeps two subscriptions independent', async () => {
  await saveBaseline();
  const secondState = join(directory, 'second.json');
  createdPaths.add(secondState);
  const saved = await invoke(
    'preview',
    'https://second-campus.example/',
    '--file',
    pagePath,
    '--select',
    '1',
    '--save',
    secondState,
  );
  expect(saved.status, saved.stderr).toBe(0);
  await writeFixture(page([{ id: 4 }, { id: 1 }, { id: 2 }]));
  expect((await refresh()).newEntries.map((entry) => entry.url)).toEqual([
    'https://future-campus.example/notice/4',
  ]);
  const second = await invoke('refresh', secondState, '--file', pagePath);
  expect(second.status, second.stderr).toBe(0);
  expect(JSON.parse(second.stdout).newEntries.map((entry: Entry) => entry.url)).toEqual([
    'https://second-campus.example/notice/4',
  ]);
});

it('R11 preserves corrupt JSON bytes instead of overwriting state', async () => {
  await saveBaseline();
  const corrupt = '{"version":1,"seenIds":';
  await writeFile(statePath, corrupt);
  const result = await invoke('refresh', statePath, '--file', pagePath);
  expect(result.status).toBe(1);
  expect(await readFile(statePath, 'utf8')).toBe(corrupt);
});

it('R12 preserves state when the website returns HTTP 503', async () => {
  const server = createServer((_request, response) =>
    response.writeHead(503).end('temporarily unavailable'),
  );
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  try {
    const address = server.address() as AddressInfo;
    await saveBaseline(`http://127.0.0.1:${address.port}/notice`);
    const before = await readFile(statePath, 'utf8');
    const result = await invoke('refresh', statePath);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('HTTP 503');
    expect(await readFile(statePath, 'utf8')).toBe(before);
  } finally {
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  }
});

it('R13 rejects a changed redirect destination without silently switching source', async () => {
  const server = createServer((request, response) => {
    if (request.url === '/notice') response.writeHead(302, { location: '/changed' }).end();
    else
      response
        .writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        .end(page([{ id: 4 }, { id: 5 }]));
  });
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  try {
    const address = server.address() as AddressInfo;
    await saveBaseline(`http://127.0.0.1:${address.port}/notice`);
    const before = await readFile(statePath, 'utf8');
    const result = await invoke('refresh', statePath);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('重定向');
    expect(await readFile(statePath, 'utf8')).toBe(before);
  } finally {
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  }
});

it('R14 preserves state when its selected container disappears or becomes ambiguous', async () => {
  await saveBaseline();
  const before = await readFile(statePath, 'utf8');
  for (const html of [
    '<h1>网站升级维护</h1>',
    page([{ id: 4 }, { id: 5 }]) + page([{ id: 6 }, { id: 7 }]),
  ]) {
    await writeFixture(html);
    const result = await invoke('refresh', statePath, '--file', pagePath);
    expect(result.status).toBe(1);
    expect(await readFile(statePath, 'utf8')).toBe(before);
  }
});

it('R15 requests reconfirmation when all expected dates disappear', async () => {
  await saveBaseline();
  const before = await readFile(statePath, 'utf8');
  await writeFixture(
    page([
      { id: 4, date: null },
      { id: 1, date: null },
      { id: 2, date: null },
    ]),
  );
  const result = await invoke('refresh', statePath, '--file', pagePath);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('失配');
  expect(await readFile(statePath, 'utf8')).toBe(before);
});

it('R16 requests reconfirmation for a real empty list while preserving history', async () => {
  await saveBaseline();
  const before = await readFile(statePath, 'utf8');
  await writeFixture(page([]));
  const result = await invoke('refresh', statePath, '--file', pagePath);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('为空');
  expect(await readFile(statePath, 'utf8')).toBe(before);
});

it('R17 requests reconfirmation when the confirmed column changes semantic category', async () => {
  await saveBaseline();
  const before = await readFile(statePath, 'utf8');
  await writeFixture(page([{ id: 41 }, { id: 42 }, { id: 43 }], '校友新闻动态'));
  const result = await invoke('refresh', statePath, '--file', pagePath);
  expect(result.status, result.stdout).toBe(1);
  expect(await readFile(statePath, 'utf8')).toBe(before);
});

it('R18 retains new events for retry when result-file delivery fails', async () => {
  await saveBaseline();
  await writeFixture(page([{ id: 4 }, { id: 1 }, { id: 2 }]));
  const failed = await invoke(
    'refresh',
    statePath,
    '--file',
    pagePath,
    '--out',
    join(directory, 'missing-parent', 'events.json'),
  );
  expect(failed.status).toBe(1);
  expect((await refresh()).newEntries.map((entry) => entry.url)).toEqual([
    'https://future-campus.example/notice/4',
  ]);
});

it('R19 loads legacy states that have no acquisition field using HTTP', async () => {
  const server = createServer((_request, response) =>
    response
      .writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      .end(page([{ id: 4 }, { id: 1 }, { id: 2 }])),
  );
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  try {
    const address = server.address() as AddressInfo;
    await saveBaseline(`http://127.0.0.1:${address.port}/notice`);
    const legacy = JSON.parse(await readFile(statePath, 'utf8'));
    delete legacy.acquisition;
    await writeFile(statePath, JSON.stringify(legacy));
    const result = await invoke('refresh', statePath);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).newEntries.map((entry: Entry) => entry.url)).toEqual([
      `http://127.0.0.1:${address.port}/notice/4`,
    ]);
  } finally {
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  }
});

it('R20 emits recovered unseen events once after a failed refresh', async () => {
  await saveBaseline();
  await writeFixture('<h1>服务暂不可用</h1>');
  expect((await invoke('refresh', statePath, '--file', pagePath)).status).toBe(1);
  await writeFixture(page([{ id: 4 }, { id: 1 }, { id: 2 }]));
  expect((await refresh()).newEntries.map((entry) => entry.url)).toEqual([
    'https://future-campus.example/notice/4',
  ]);
  expect((await refresh()).newEntries).toEqual([]);
});

it('R21 rejects credential-bearing and non-HTTP URLs before saving state', async () => {
  await writeFixture(page([{ id: 1 }, { id: 2 }, { id: 3 }]));
  for (const url of [
    'file:///C:/notice.html',
    'javascript:alert(1)',
    'https://user:password@future-campus.example/notice',
  ]) {
    const result = await invoke(
      'preview',
      url,
      '--file',
      pagePath,
      '--select',
      '1',
      '--save',
      statePath,
    );
    expect(result.status).toBe(1);
    await expect(readFile(statePath)).rejects.toThrow();
  }
});

it('R22 follows the user-confirmed second column across refresh', async () => {
  const both = (ids: number[]) =>
    page([{ id: 1 }, { id: 2 }, { id: 3 }]) +
    page(
      ids.map((id) => ({ id })),
      '研究生通知公告',
      'graduate',
    );
  await writeFixture(both([41, 42, 43]));
  const preview = await invoke('preview', origin, '--file', pagePath);
  expect(preview.status, preview.stderr).toBe(0);
  const candidates = JSON.parse(preview.stdout).candidates as { entries: Entry[] }[];
  const selected =
    candidates.findIndex((candidate) =>
      candidate.entries.some((entry) => entry.url === 'https://future-campus.example/notice/41'),
    ) + 1;
  expect(selected).toBeGreaterThan(0);
  const saved = await invoke(
    'preview',
    origin,
    '--file',
    pagePath,
    '--select',
    String(selected),
    '--save',
    statePath,
  );
  expect(saved.status, saved.stderr).toBe(0);
  await writeFixture(both([44, 41, 42]));
  expect((await refresh()).newEntries.map((entry) => entry.url)).toEqual([
    'https://future-campus.example/notice/44',
  ]);
});

it('R23 establishes each subscription baseline independently even for shared article URLs', async () => {
  await saveBaseline();
  const secondState = join(directory, 'shared.json');
  createdPaths.add(secondState);
  await writeFixture(page([{ id: 4 }, { id: 1 }, { id: 2 }]));
  const saved = await invoke(
    'preview',
    origin,
    '--file',
    pagePath,
    '--select',
    '1',
    '--save',
    secondState,
  );
  expect(saved.status, saved.stderr).toBe(0);
  expect((await refresh()).newEntries.map((entry) => entry.url)).toEqual([
    'https://future-campus.example/notice/4',
  ]);
  const second = await invoke('refresh', secondState, '--file', pagePath);
  expect(second.status, second.stderr).toBe(0);
  expect(JSON.parse(second.stdout).newEntries).toEqual([]);
});

it('R24 resumes a copied persisted state in a completely new CLI process', async () => {
  await saveBaseline();
  const restoredPath = join(directory, 'restored.json');
  createdPaths.add(restoredPath);
  await writeFile(restoredPath, await readFile(statePath));
  await writeFixture(page([{ id: 5 }, { id: 1 }, { id: 2 }]));
  const restored = await invoke('refresh', restoredPath, '--file', pagePath);
  expect(restored.status, restored.stderr).toBe(0);
  expect(JSON.parse(restored.stdout).newEntries.map((entry: Entry) => entry.url)).toEqual([
    'https://future-campus.example/notice/5',
  ]);
});

it('R25 preserves independently specified Chinese title, URL and date fields', async () => {
  const saved = await saveBaseline();
  const candidates = JSON.parse(saved.stdout).candidates as { entries: Entry[] }[];
  expect(candidates[0]?.entries).toEqual(
    [1, 2, 3].map((id) => ({
      id: `https://future-campus.example/notice/${id}`,
      title: `学院正式公告第 ${id} 条`,
      url: `https://future-campus.example/notice/${id}`,
      publishedAt: '2026-11-01',
    })),
  );
});
