import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { reply } from '../../test/mock-model';
import { loadPi, openPiSession, rewindLastUser } from '../pi';
import { MockOpenAiServer, mockFrames } from './mock-openai-server';

it('edit 要求先 read，重新加载会话、压缩或切换分支后须再读', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'dela-edit-'));
  const path = join(cwd, 'note.txt');
  writeFileSync(path, 'first\nsecond');
  writeFileSync(join(cwd, 'other.txt'), 'first');
  const server = await MockOpenAiServer.start();
  const pi = await loadPi();
  const history = pi.SessionManager.inMemory(cwd);
  const open = () =>
    openPiSession({
      cwd,
      inMemory: history,
      selection: {
        provider: {
          id: 'edit-test',
          name: 'mock',
          baseUrl: server.baseUrl,
          apiKey: 'test-only',
          models: ['mock-model'],
          piProvider: null,
          enabled: true,
        },
        model: 'mock-model',
        effort: null,
      },
      appendSystemPrompt: [],
      customTools: [],
      shellPath: 'bash',
      skillPaths: [],
      disabledSkills: new Set(),
      globalSkillDirs: [],
      disabledTools: [],
    });
  let session = await open();
  const call = async (name: string, args: object) => {
    const id = randomUUID();
    server.enqueue({
      kind: 'sse',
      frames: [
        mockFrames.toolCallDelta({ index: 0, id, name, arguments: JSON.stringify(args) }),
        mockFrames.finishFrame('tool_calls'),
      ],
    });
    server.enqueue(reply('OK'));
    await session.prompt(name);
    return session.messages.findLast((m) => m.role === 'toolResult' && m.toolCallId === id);
  };
  const edit = (oldText: string, newText: string) =>
    call('edit', { path, edits: [{ oldText, newText }] });
  const blocked = { isError: true, content: [{ type: 'text', text: "File hasn't been read yet" }] };
  try {
    await call('read', { path: 'other.txt' });
    expect(await call('read', { path, offset: 99 })).toMatchObject({ isError: true });
    expect(await edit('first', 'edited')).toMatchObject(blocked);
    expect(readFileSync(path, 'utf8')).toBe('first\nsecond');

    await call('read', { path: './note.txt', limit: 1 });
    expect(await edit('first', 'edited')).toMatchObject({ isError: false });
    session.dispose();
    session = await open();
    expect(await edit('second', 'reopened')).toMatchObject(blocked);
    await call('read', { path });
    expect(await edit('second', 'reopened')).toMatchObject({ isError: false });
    server.enqueue(reply('OK'));
    await session.prompt('keep this turn '.repeat(100));
    session.settingsManager.applyOverrides({ compaction: { keepRecentTokens: 64 } });
    server.enqueue(reply('summary mentioning note.txt'));
    await session.compact();
    expect(await edit('edited', 'again')).toMatchObject(blocked);
    expect(readFileSync(path, 'utf8')).toBe('edited\nreopened');
    await call('read', { path });
    const beforeLastQuestion = history.getLeafId();
    expect(await edit('edited', 'again')).toMatchObject({ isError: false });
    expect(readFileSync(path, 'utf8')).toBe('again\nreopened');

    await rewindLastUser(session);
    expect(history.getLeafId()).toBe(beforeLastQuestion);
    expect(await edit('again', 'rewritten')).toMatchObject(blocked);
  } finally {
    session.dispose();
    await server.close();
    rmSync(cwd, { recursive: true, force: true });
  }
}, 30_000);
