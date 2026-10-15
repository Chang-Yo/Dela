// 条款接受记录：界面只能报「哪一份、哪一版」，应用版本与时间由主进程盖章；
// 记录只追加不改写，条款改版后再次接受会留下新行。
import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const state = vi.hoisted(() => ({
  root: '',
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
}));

vi.mock('electron', () => ({
  app: { getPath: () => state.root, getVersion: () => '1.1.0', isPackaged: false },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      state.handlers.set(channel, handler);
    },
  },
}));

import { closeDatabase, getDatabase } from '../database';
import { registerConsentIpc } from '../consent';

const frame = { url: 'file:///index.html' };
const event = { senderFrame: frame, sender: { mainFrame: frame } };

function setup() {
  state.root = mkdtempSync(join(tmpdir(), 'dela-consent-'));
  registerConsentIpc();
  const handler = state.handlers.get('consent:record');
  if (!handler) throw new Error('没有注册 consent:record');
  return handler;
}

function rows() {
  return getDatabase()
    .prepare(
      'SELECT document, revision, app_version AS appVersion, accepted_at AS at FROM consent_records ORDER BY id',
    )
    .all() as { document: string; revision: string; appVersion: string; at: string }[];
}

afterEach(() => {
  state.handlers.clear();
  closeDatabase();
  rmSync(state.root, { recursive: true, force: true });
});

it('每一次接受各留一行，带应用版本与可比较的时间', () => {
  const handler = setup();
  handler(event, 'terms', '2026-10-15');
  handler(event, 'privacy', '2026-10-15');
  // 条款改版后重新接受：历史行不动，只追加。
  handler(event, 'terms', '2027-01-01');

  expect(rows().map((row) => [row.document, row.revision, row.appVersion])).toEqual([
    ['terms', '2026-10-15', '1.1.0'],
    ['privacy', '2026-10-15', '1.1.0'],
    ['terms', '2027-01-01', '1.1.0'],
  ]);
  expect(Date.parse(rows()[0]!.at)).not.toBeNaN();
});

it('只认识两份条款，版本号不能为空', () => {
  const handler = setup();
  expect(() => handler(event, 'cookie-policy', '2026-10-15')).toThrow();
  expect(() => handler(event, 'terms', '')).toThrow();
  expect(getDatabase().prepare('SELECT COUNT(*) AS count FROM consent_records').get()).toEqual({
    count: 0,
  });
});

it('不是主窗口发来的调用被拒绝', () => {
  const handler = setup();
  const other = { url: 'https://evil.example/' };
  expect(() => handler({ senderFrame: other, sender: { mainFrame: other } }, 'terms', 'x')).toThrow(
    '不允许的调用来源',
  );
});
