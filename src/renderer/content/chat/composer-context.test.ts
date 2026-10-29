// 输入框上方的项目浮岛：只在新对话出现，通用池显示「随聊」。
import { expect, it } from 'vitest';
import type { WorkspaceChat, WorkspaceEntry } from '../../../shared/api';
import { composerContext } from './composer-context';

function chat(patch: Partial<WorkspaceChat> = {}): WorkspaceChat {
  return {
    sessionId: 's1',
    projectId: null,
    cwd: null,
    configured: true,
    providerId: null,
    providerName: null,
    model: 'm',
    modelUnavailable: false,
    effortLevels: [],
    effort: null,
    messages: [],
    ...patch,
  };
}

const project: WorkspaceEntry = {
  id: 'p1',
  parentId: null,
  name: 'Dela',
  kind: 'project',
  sourceId: null,
  path: 'E:/repo/Dela',
  updatedAt: '2026-10-09T00:00:00.000Z',
};

it('通用池的新对话显示「随聊」，没有项目 id', () => {
  expect(composerContext(chat(), null)).toEqual({ projectId: null, name: '随聊', remote: false });
});

it('项目的新对话显示项目名与项目 id', () => {
  expect(composerContext(chat({ projectId: 'p1' }), project)).toEqual({
    projectId: 'p1',
    name: 'Dela',
    remote: false,
  });
});

it('远端项目标记为 remote，图标与本地项目区分', () => {
  expect(composerContext(chat({ projectId: 'p1' }), { ...project, remoteId: 'r1' })).toEqual({
    projectId: 'p1',
    name: 'Dela',
    remote: true,
  });
});

it('已有历史、正在运行或本轮在途时都不显示浮岛', () => {
  expect(composerContext(chat({ messages: [{ role: 'user', content: 'hi' }] }), null)).toBeNull();
  expect(composerContext(chat({ running: true }), null)).toBeNull();
  expect(composerContext(chat(), null, true)).toBeNull();
  expect(composerContext(null, null)).toBeNull();
});
