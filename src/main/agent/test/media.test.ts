import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  root: '',
  missing: false,
  disabled: false,
  sessions: [] as { file: string }[],
}));
state.root = mkdtempSync(join(tmpdir(), 'dela-media-'));
vi.mock('electron', () => ({
  app: { getPath: () => state.root },
  nativeImage: {},
  dialog: {},
}));
vi.mock('../../documents/runtime', () => ({
  DOCUMENT_SKILL: 'document-reading',
  assertDocumentDependency: () => {
    if (state.missing) throw new Error('请先安装文档读取组件');
  },
}));
vi.mock('../skills', () => ({
  readDisabledSkills: () => new Set(state.disabled ? ['document-reading'] : []),
}));
vi.mock('../../database', () => ({
  getDatabase: () => ({ prepare: () => ({ all: () => state.sessions }) }),
}));
import {
  gcChatMedia,
  readChatAttachment,
  releaseChatAttachments,
  releaseChatMedia,
  stageChatMedia,
} from '../media';

beforeEach(() => {
  state.missing = false;
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

it('removes an unsent document when the attachment is removed', () => {
  const view = stageChatMedia('invitation.pdf', Buffer.from('%PDF-'));
  const attachment = readChatAttachment(view.id);
  if (!('path' in attachment)) throw new Error('expected local document');
  releaseChatMedia([view.id]);
  expect(existsSync(attachment.path)).toBe(false);
});

it('keeps text attachments in memory and checks missing or disabled document dependencies', () => {
  const view = stageChatMedia('notes.txt', Buffer.from('正文'));
  expect(readChatAttachment(view.id)).toEqual({ name: 'notes.txt', bytes: Buffer.from('正文') });
  releaseChatAttachments([view.id]);
  expect(() => readChatAttachment(view.id)).toThrow('不存在');
  state.missing = true;
  expect(() => stageChatMedia('file.pdf', Buffer.from('%PDF-'))).toThrow('安装');
  state.missing = false;
  state.disabled = true;
  expect(() => stageChatMedia('file.pptx', Buffer.from('PK'))).toThrow('启用');
});
