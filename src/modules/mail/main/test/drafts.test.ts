import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { expect, it, vi } from 'vitest';
import { provideTestHostPorts } from '../../../../core/test/host-mock';
import { isPreparedSent, markPreparedSent, openEmailDraft, prepareEmail } from '../drafts';

vi.mock('electron', () => ({ app: { getPath: () => tmpdir() } }));

it('Agent 准备的草稿发出后不能再次打开发送', async () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE workspace_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  provideTestHostPorts({ database: () => db });

  const { draftId } = prepareEmail({ to: ['a@example.com'], subject: '周报', text: '正文' });
  expect(isPreparedSent(draftId)).toBe(false);
  markPreparedSent(draftId);
  expect(isPreparedSent(draftId)).toBe(true);
  await expect(openEmailDraft(draftId)).rejects.toThrow('已经发送过');
});
