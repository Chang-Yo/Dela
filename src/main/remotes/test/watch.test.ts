// 远端目录 watch 的接线：渲染端报的集合 → helper 的 setWatch；helper 的事件 → notifyRemoteChange。
// 真机行为（inotify 到底推什么、合并不合并）在 helper.test.ts 与 remote-smoke 里验。
import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => process.cwd(), getPath: () => process.cwd() },
}));

/** 假会话：记下被报上来的集合，并允许测试手动推事件。 */
class FakeSession {
  sets = new Map<string, string[]>();
  cleared: string[] = [];
  private listeners = new Set<(event: unknown) => void>();

  async setWatch(id: string, paths: string[]) {
    this.sets.set(id, paths);
    return { watching: paths.length, skipped: [] };
  }

  async clearWatch(id: string) {
    this.cleared.push(id);
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

let session: FakeSession | null = null;
vi.mock('../helper', () => ({
  helperSession: async () => session,
}));

import { onRemoteChange } from '../events';
import { closeRemoteWatch, unwatchRemoteProject, watchRemoteProject } from '../watch';

const target = { host: 'user@10.0.0.5', keyPath: null };
const other = { host: 'user@10.0.0.6', keyPath: null };

function collect() {
  const seen: string[] = [];
  const stop = onRemoteChange((path) => seen.push(path));
  return { seen, stop };
}

beforeEach(() => {
  closeRemoteWatch();
  session = new FakeSession();
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
  expect(session!.sets.get('p-1')).toEqual(['/home/u/proj', '/home/u/proj/src']);

  await vi.waitFor(() => expect(session!.sets.get('p-1')).toBeTruthy());
  session!.emit({ type: 'change', id: 'p-1', paths: ['/home/u/proj/src'] });
  expect(seen).toEqual(['/home/u/proj/src']);

  // reset（内核队列溢出/订阅者卡住）：按项目根报一次就够，目录树会重读根以下所有层。
  session!.emit({ type: 'reset', id: '*', reason: 'overflow' });
  expect(seen).toEqual(['/home/u/proj/src', '/home/u/proj']);
  stop();
});

it('撤销监视会告诉 helper，空集合等于取消', async () => {
  await watchRemoteProject({ projectId: 'p-1', target, root: '/home/u/proj', paths: ['/x'] });
  await vi.waitFor(() => expect(session!.sets.get('p-1')).toBeTruthy());
  await unwatchRemoteProject('p-1');
  expect(session!.cleared).toContain('p-1');

  const empty = await watchRemoteProject({
    projectId: 'p-1',
    target,
    root: '/home/u/proj',
    paths: [],
  });
  expect(empty.watching).toBe(0);
});

it('helper 起不来时不报错，只是拿不到监视', async () => {
  session = null;
  const result = await watchRemoteProject({
    projectId: 'p-1',
    target,
    root: '/home/u/proj',
    paths: ['/home/u/proj'],
  });
  expect(result.watching).toBe(0);
});

it('换到另一个远端目标后只服务新目标，切回来能立刻恢复', async () => {
  const { seen, stop } = collect();
  await watchRemoteProject({ projectId: 'p-1', target, root: '/one', paths: ['/one'] });
  await vi.waitFor(() => expect(session!.sets.get('p-1')).toBeTruthy());
  // 另一个目标被用到（全局只有一条通道）：旧目标的流让位，但集合留着。
  await watchRemoteProject({ projectId: 'p-2', target: other, root: '/two', paths: ['/two'] });
  await vi.waitFor(() => expect(session!.sets.get('p-2')).toBeTruthy());
  session!.emit({ type: 'reset', id: '*', reason: 'overflow' });
  expect(seen).toEqual(['/two']);

  // 切回来：集合重新报上（换了 helper 实例就没了），事件也跟着回来。
  await watchRemoteProject({ projectId: 'p-1', target, root: '/one', paths: ['/one'] });
  await vi.waitFor(() => expect(session!.sets.get('p-1')).toEqual(['/one']));
  session!.emit({ type: 'change', id: 'p-1', paths: ['/one/sub'] });
  expect(seen).toEqual(['/two', '/one/sub']);
  stop();
});
