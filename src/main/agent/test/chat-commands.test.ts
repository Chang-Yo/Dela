// 自定义指令：与内置会话命令（/compact、/reload、/name、/new）同名的新建与改名被拒绝，报错是能读的一句话。
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, expect, it, vi } from 'vitest';

let database: DatabaseSync;
vi.mock('../../database', () => ({ getDatabase: () => database }));

import { listChatCommands, saveChatCommand } from '../chat-commands';

beforeEach(() => {
  database = new DatabaseSync(':memory:');
  database.exec('CREATE TABLE workspace_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
});

it('rejects custom commands named after a session command, in any case', () => {
  expect(() => saveChatCommand({ name: 'compact', prompt: '总结一下' })).toThrow(
    '/compact 是内置命令，请换一个名称',
  );
  expect(() => saveChatCommand({ name: 'New', prompt: '开新对话' })).toThrow('内置命令');
  const saved = saveChatCommand({ name: '周报', prompt: '汇总本周' });
  expect(() => saveChatCommand({ id: saved.id, name: 'reload', prompt: '汇总本周' })).toThrow(
    '内置命令',
  );
  expect(listChatCommands().map((command) => command.name)).toEqual(['周报']);
});
