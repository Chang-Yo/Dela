// 条款接受记录：界面只能报「哪一份、哪一版」，应用版本与时间由主进程盖章；
// 记录只追加不改写，条款改版后再次接受会留下新行。
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const state = vi.hoisted(() => ({ root: '' }));

vi.mock('electron', () => ({
  app: { getPath: () => state.root, getVersion: () => '1.1.0', isPackaged: false },
}));

import { closeDatabase, getDatabase } from '../../../../app/main/database';
import { provideTestHostPorts } from '../../../../core/test/host-mock';
import { settingsContract } from '../../contract';
import { hasConsented, recordConsent } from '../consent';

beforeEach(() => {
  state.root = mkdtempSync(join(tmpdir(), 'dela-consent-'));
  provideTestHostPorts({ paths: { userData: () => state.root }, database: getDatabase });
});

function rows() {
  return getDatabase()
    .prepare(
      'SELECT document, revision, app_version AS appVersion, accepted_at AS at FROM consent_records ORDER BY id',
    )
    .all() as { document: string; revision: string; appVersion: string; at: string }[];
}

afterEach(() => {
  closeDatabase();
  rmSync(state.root, { recursive: true, force: true });
});

it('每一次接受各留一行，带应用版本与可比较的时间', () => {
  recordConsent('terms', '2026-10-15');
  recordConsent('privacy', '2026-10-15');
  // 条款改版后重新接受：历史行不动，只追加。
  recordConsent('terms', '2027-01-01');

  expect(rows().map((row) => [row.document, row.revision, row.appVersion])).toEqual([
    ['terms', '2026-10-15', '1.1.0'],
    ['privacy', '2026-10-15', '1.1.0'],
    ['terms', '2027-01-01', '1.1.0'],
  ]);
  expect(Date.parse(rows()[0]!.at)).not.toBeNaN();
});

it('只认识两份条款，版本号不能为空', () => {
  const input = settingsContract.procedures.recordConsent.input;
  expect(() => input.parse({ document: 'cookie-policy', revision: '2026-10-15' })).toThrow();
  expect(() => input.parse({ document: 'terms', revision: '' })).toThrow();
});

it('两份条款都有接受记录才算接受过', () => {
  expect(hasConsented()).toBe(false);
  recordConsent('terms', '2026-10-15');
  expect(hasConsented()).toBe(false);
  recordConsent('privacy', '2026-10-15');
  expect(hasConsented()).toBe(true);
});
