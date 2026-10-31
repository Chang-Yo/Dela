import { beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  list: vi.fn(),
  count: vi.fn(),
  create: vi.fn(),
  read: vi.fn(),
  row: vi.fn(),
  start: vi.fn(),
  wait: vi.fn(),
  cancel: vi.fn(),
}));

vi.mock('../../../session', () => ({
  listSessions: state.list,
  countSessions: state.count,
  newSession: state.create,
  readSession: state.read,
  row: state.row,
  startSessionRun: state.start,
  waitSessionRun: state.wait,
  cancelSessionRun: state.cancel,
}));

import { sessionTools } from '../index';

beforeEach(() => {
  vi.clearAllMocks();
  state.list.mockReturnValue([{ id: 's1' }]);
  state.count.mockReturnValue(1);
  state.create.mockReturnValue({ sessionId: 's2' });
  state.read.mockReturnValue({
    sessionId: 's1',
    projectId: null,
    messages: [{ role: 'user', content: '你好' }],
  });
  state.row.mockReturnValue({ title: '标题', project_id: null, archived: 0 });
  state.start.mockResolvedValue('run-1');
  state.wait.mockResolvedValue({ runId: 'run-1', status: 'completed' });
  state.cancel.mockReturnValue({ runId: 'run-1', status: 'running' });
});

it('lists all projects with stable pagination metadata', () => {
  expect(sessionTools.list_sessions.execute({ limit: 20, offset: 0 })).toEqual({
    items: [{ id: 's1' }],
    total: 1,
    nextOffset: null,
  });
  expect(state.list).toHaveBeenCalledWith(undefined, '', false, 0, 20);
});

it('creates a fresh session and reads projected messages', async () => {
  expect(sessionTools.create_session.execute({ projectId: null, scope: 'chat' })).toEqual({
    sessionId: 's2',
  });
  expect(state.create).toHaveBeenCalledWith(null, 'chat', true);
  expect(
    sessionTools.read_session.execute({ sessionId: '00000000-0000-4000-8000-000000000001' }),
  ).toMatchObject({ items: [{ content: '你好' }], total: 1 });
});

it('rejects sending to archived sessions and exposes asynchronous run controls', async () => {
  state.row.mockReturnValue({ title: '归档', project_id: null, archived: 1 });
  await expect(
    sessionTools.send_session_message.execute({
      sessionId: '00000000-0000-4000-8000-000000000001',
      text: '继续',
    }),
  ).rejects.toThrow('首版不支持');

  state.row.mockReturnValue({ title: '活动', project_id: null, archived: 0 });
  await expect(
    sessionTools.send_session_message.execute({
      sessionId: '00000000-0000-4000-8000-000000000001',
      text: '继续',
    }),
  ).resolves.toEqual({
    runId: 'run-1',
    sessionId: '00000000-0000-4000-8000-000000000001',
    status: 'running',
  });
  await expect(
    sessionTools.wait_session_run.execute({ runId: 'run-1', timeoutMs: 100 }),
  ).resolves.toMatchObject({ status: 'completed' });
  expect(sessionTools.cancel_session_run.execute({ runId: 'run-1' })).toMatchObject({
    status: 'running',
  });
});
