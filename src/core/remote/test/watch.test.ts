// 远端目录 watch 的接线：渲染端报的集合 → helper 的 setWatch；helper 的事件 → notifyRemoteChange。
// 真机行为（inotify 到底推什么、合并不合并）在 helper.test.ts 与 remote-smoke 里验。
import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => process.cwd(), getPath: () => process.cwd() },
}));

class FakeSession {
  sets = new Map<string, string[]>();
  listeners = new Set<(event: unknown) => void>();

  async setWatch(id: string, paths: string[]) {
    this.sets.set(id, paths);
    return { watching: paths.length, skipped: [] };
  }

  async clearWatch(id: string) {
    this.sets.delete(id);
  }

  async watchEvents(onEvent: (event: unknown) => void, signal?: AbortSignal) {
    this.listeners.add(onEvent);
    await new Promise<void>((resolve) => {
      if (signal?.aborted) resolve();
      else signal?.addEventListener('abort', () => resolve(), { once: true });
    });
    this.listeners.delete(onEvent);
  }

  emit(event: unknown) {
    for (const listener of [...this.listeners]) listener(event);
  }
}

const sessions = new Map<string, FakeSession>();

vi.mock('../helper', () => ({
  helperSession: (target: { host: string }) => sessions.get(target.host)!,
}));

import { onRemoteChange } from '../events';
import { closeRemoteWatch, unwatchRemoteProject, watchRemoteProject } from '../watch';

const target = { host: 'user@10.0.0.5', keyPath: null };
const other = { host: 'user@10.0.0.6', keyPath: null };

const fake = (host: string) => sessions.get(host)!;

function collect() {
  const seen: string[] = [];
  const stop = onRemoteChange((path) => seen.push(path));
  return { seen, stop };
}

beforeEach(async () => {
  closeRemoteWatch();
  // 让上一条流的 abort 落地（假会话要等 abort 才摘掉监听器），免得上一条用例的事件串进来。
  await new Promise((resolve) => setTimeout(resolve, 0));
  sessions.clear();
  sessions.set(target.host, new FakeSession());
  sessions.set(other.host, new FakeSession());
});

it('报上集合后 helper 收到监视，change 事件推成目录变化', async () => {
  const { seen, stop } = collect();
  const result = await watchRemoteProject({
    projectId: 'p-1',
    target,
    root: '/home/u/proj',
    paths: ['/home/u/proj', '/home/u/proj/src'],
  });
  expect(result.watching).toBe(2);
  expect(fake(target.host).sets.get('p-1')).toEqual(['/home/u/proj', '/home/u/proj/src']);

  await vi.waitFor(() => expect(fake(target.host).sets.get('p-1')).toBeTruthy());
  fake(target.host).emit({ type: 'change', id: 'p-1', paths: ['/home/u/proj/src'] });
  expect(seen).toEqual(['/home/u/proj/src']);

  fake(target.host).emit({ type: 'reset', id: '*', reason: 'overflow' });
  expect(seen).toEqual(['/home/u/proj/src', '/home/u/proj']);
  stop();
});

it('两个目标各有一条流：一台的事件不回到另一台', async () => {
  const { seen, stop } = collect();
  await watchRemoteProject({ projectId: 'p-1', target, root: '/one', paths: ['/one'] });
  await vi.waitFor(() => expect(fake(target.host).sets.get('p-1')).toBeTruthy());
  await watchRemoteProject({ projectId: 'p-2', target: other, root: '/two', paths: ['/two'] });
  await vi.waitFor(() => expect(fake(other.host).sets.get('p-2')).toBeTruthy());
  expect(fake(target.host).sets.get('p-1')).toEqual(['/one']);

  fake(other.host).emit({ type: 'reset', id: '*', reason: 'overflow' });
  expect(seen).toEqual(['/two']);
  fake(target.host).emit({ type: 'change', id: 'p-1', paths: ['/one/sub'] });
  expect(seen).toEqual(['/two', '/one/sub']);

  await unwatchRemoteProject('p-1');
  await vi.waitFor(() => expect(fake(target.host).listeners.size).toBe(0));
  fake(target.host).emit({ type: 'change', id: 'p-1', paths: ['/one/ignored'] });
  fake(other.host).emit({ type: 'change', id: 'p-2', paths: ['/two/sub'] });
  expect(seen).toEqual(['/two', '/one/sub', '/two/sub']);
  stop();
});
