import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  root: '',
  disabled: false,
  sessions: [] as { file: string }[],
}));
state.root = mkdtempSync(join(tmpdir(), 'dela-media-'));
vi.mock('electron', () => ({
  app: { getPath: () => state.root },
  nativeImage: {},
  dialog: {},
}));
vi.mock('../../capabilities/tools', () => ({
  readDisabledTools: () => new Set(state.disabled ? ['read_document'] : []),
}));
import { provideTestHostPorts } from '../../test/host-mock';
import { gcChatMedia, readChatAttachment, releaseChatAttachments, stageChatMedia } from '../media';

beforeEach(() => {
  provideTestHostPorts({
    paths: { userData: () => state.root },
    database: () => ({ prepare: () => ({ all: () => state.sessions }) }) as never,
  });
  state.disabled = false;
  state.sessions = [];
});
afterAll(() => rmSync(state.root, { recursive: true, force: true }));

it('stages documents as files, retains sent files referenced by sessions, and collects orphan files', () => {
  const bytes = Buffer.from([80, 75, 3, 4, 255, 0]);
  const view = stageChatMedia('PRP结项汇报_v3(1).pptx.pptx', bytes);
  const attachment = readChatAttachment(view.id);
  expect('path' in attachment).toBe(true);
  if (!('path' in attachment)) throw new Error('document was decoded as text');
  expect(readFileSync(attachment.path).equals(bytes)).toBe(true);
  releaseChatAttachments([view.id]);
  expect(existsSync(attachment.path)).toBe(true);
  const session = join(state.root, 'session.jsonl');
  writeFileSync(session, JSON.stringify({ attachments: [{ id: view.id, name: view.name }] }));
  state.sessions = [{ file: session }];
  gcChatMedia();
  expect(existsSync(attachment.path)).toBe(true);
  state.sessions = [];
  gcChatMedia();
  expect(existsSync(attachment.path)).toBe(false);
});

it('keeps text attachments in memory and refuses documents while read_document is off', () => {
  const view = stageChatMedia('notes.txt', Buffer.from('正文'));
  expect(readChatAttachment(view.id)).toEqual({ name: 'notes.txt', bytes: Buffer.from('正文') });
  releaseChatAttachments([view.id]);
  expect(() => readChatAttachment(view.id)).toThrow('不存在');
  state.disabled = true;
  expect(() => stageChatMedia('file.pptx', Buffer.from('PK'))).toThrow('MinerU Token');
});
