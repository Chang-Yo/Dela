import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocumentContent } from '../../../shared/api';
import { useNoteDrafts } from './drafts';

const content: DocumentContent = { title: 'Note', format: 'markdown', text: 'old', revision: 'r1' };

function installDela(
  read: (id: string) => Promise<DocumentContent>,
  saveNote: (id: string, text: string, revision: string) => Promise<string>,
) {
  const readMock = vi.fn(read);
  const saveMock = vi.fn(saveNote);
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      dela: {
        workspace: { read: readMock, saveNote: saveMock },
        canvas: { read: vi.fn() },
        shuiyuan: {},
      },
    },
  });
  return { readMock, saveMock };
}

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  useNoteDrafts.setState({ drafts: {} });
});

beforeEach(() => vi.useFakeTimers());

describe('draft relocation', () => {
  it('移动 Mac 目录保留文件名和正文，不迁移同前缀的兄弟文件草稿', () => {
    const draft = { content, text: 'unsaved', saved: 'old', saving: false, error: null };
    const child = '/repo/a/note\\draft.md';
    const sibling = '/repo/a\\note.md';
    useNoteDrafts.setState({ drafts: { [child]: draft, [sibling]: draft } });
    useNoteDrafts.getState().relocatePaths('/repo/a', '/repo/b');
    expect(useNoteDrafts.getState().drafts).toEqual({
      '/repo/b/note\\draft.md': { ...draft, content: { ...content, title: 'note\\draft.md' } },
      [sibling]: draft,
    });
  });
});

describe('draft debounce', () => {
  it('saves once with the latest text after 600ms; each edit restarts the timer', async () => {
    const { saveMock } = installDela(
      async () => ({ ...content }),
      vi.fn(async () => 'r2'),
    );
    const store = useNoteDrafts.getState();
    await store.acquire('debounce');
    store.edit('debounce', 'a');
    await vi.advanceTimersByTimeAsync(599);
    expect(saveMock).not.toHaveBeenCalled();
    store.edit('debounce', 'b');
    await vi.advanceTimersByTimeAsync(599);
    expect(saveMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(saveMock).toHaveBeenCalledWith('debounce', 'b', 'r1');
    expect(useNoteDrafts.getState().drafts['debounce']).toMatchObject({
      text: 'b',
      saved: 'b',
      saving: false,
      error: null,
    });
  });

  it('ignores edits for keys without a draft and drops the pending timer on release', async () => {
    const { saveMock } = installDela(
      async () => ({ ...content }),
      vi.fn(async () => 'r2'),
    );
    const store = useNoteDrafts.getState();
    store.edit('missing', 'text');
    await vi.advanceTimersByTimeAsync(600);
    expect(saveMock).not.toHaveBeenCalled();
    await store.acquire('flush');
    store.edit('flush', 'draft');
    await expect(store.release('flush')).resolves.toBe(true);
    expect(saveMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(600);
    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(useNoteDrafts.getState().drafts['flush']).toBeUndefined();
  });
});

describe('draft save mutex', () => {
  it('shares an in-flight save and persists the latest text observed before it finishes', async () => {
    const finishes: ((revision: string) => void)[] = [];
    const { saveMock } = installDela(
      async () => ({ ...content }),
      () => new Promise<string>((resolve) => finishes.push(resolve)),
    );
    const store = useNoteDrafts.getState();
    await store.acquire('mutex');
    store.edit('mutex', 'first');
    const first = store.save('mutex');
    store.edit('mutex', 'latest');
    const second = store.save('mutex');
    expect(second).toBe(first);
    finishes.shift()!('r2');
    await Promise.resolve();
    finishes.shift()!('r3');
    await first;
    expect(saveMock).toHaveBeenCalledTimes(2);
    expect(saveMock).toHaveBeenLastCalledWith('mutex', 'latest', 'r2');
    expect(useNoteDrafts.getState().drafts['mutex']).toMatchObject({
      text: 'latest',
      saved: 'latest',
      saving: false,
      error: null,
    });
  });

  it('resolves false on a failed save and retains the dirty draft for retry or recovery', async () => {
    const { saveMock } = installDela(
      async () => ({ ...content }),
      vi.fn(async () => {
        throw new Error('disk full');
      }),
    );
    const store = useNoteDrafts.getState();
    await store.acquire('failed');
    store.edit('failed', 'draft');
    await expect(store.save('failed')).resolves.toBe(false);
    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(useNoteDrafts.getState().drafts['failed']).toMatchObject({
      text: 'draft',
      saved: 'old',
      saving: false,
      error: 'disk full',
    });
  });

  it('refuses to save a document without a revision', async () => {
    const { saveMock } = installDela(
      async () => ({ ...content, revision: undefined }),
      vi.fn(async () => 'r2'),
    );
    const store = useNoteDrafts.getState();
    await store.acquire('norev');
    store.edit('norev', 'draft');
    await expect(store.save('norev')).resolves.toBe(false);
    expect(saveMock).not.toHaveBeenCalled();
    expect(useNoteDrafts.getState().drafts['norev']).toMatchObject({
      error: '此文档没有可用的保存版本。',
    });
  });
});

describe('draft acquire', () => {
  it('shares one in-flight load and reuses the existing draft on later acquires', async () => {
    let pending!: (value: typeof content) => void;
    const { readMock } = installDela(
      () => new Promise((resolve) => (pending = resolve)),
      vi.fn(async () => 'r2'),
    );
    const store = useNoteDrafts.getState();
    const first = store.acquire('load');
    const second = store.acquire('load');
    pending({ ...content });
    await Promise.all([first, second]);
    expect(readMock).toHaveBeenCalledTimes(1);
    await store.acquire('load');
    expect(readMock).toHaveBeenCalledTimes(1);
  });

  it('keeps a newer edit when a forced acquire started before that edit', async () => {
    let finish!: (value: typeof content) => void;
    const { readMock } = installDela(
      () => new Promise((resolve) => (finish = resolve)),
      vi.fn(async () => 'r2'),
    );
    const store = useNoteDrafts.getState();
    const first = store.acquire('force');
    finish({ ...content });
    await first;
    expect(readMock).toHaveBeenCalledTimes(1);
    const pending = store.acquire('force', true);
    store.edit('force', 'newer');
    finish({ ...content, text: 'from disk', revision: 'r3' });
    await pending;
    expect(readMock).toHaveBeenCalledTimes(2);
    expect(useNoteDrafts.getState().drafts['force']).toMatchObject({
      text: 'newer',
      saved: 'old',
    });
  });

  it('waits for an in-flight save before a forced reload, then replaces clean content', async () => {
    const finishes: ((revision: string) => void)[] = [];
    let reads = 0;
    installDela(
      async () => {
        reads += 1;
        return reads === 1 ? { ...content } : { ...content, text: 'fresh', revision: 'r9' };
      },
      () => new Promise<string>((resolve) => finishes.push(resolve)),
    );
    const store = useNoteDrafts.getState();
    await store.acquire('reload');
    store.edit('reload', 'draft');
    const saving = store.save('reload');
    const forcing = store.acquire('reload', true);
    finishes.shift()!('r2');
    await saving;
    await forcing;
    expect(useNoteDrafts.getState().drafts['reload']).toMatchObject({
      text: 'fresh',
      saved: 'fresh',
      error: null,
    });
  });
});

describe('draft acquire/release reference counting', () => {
  it('keeps the draft while another entry point still holds it, flushes on the final release', async () => {
    const { saveMock } = installDela(
      async () => ({ ...content }),
      vi.fn(async () => 'r2'),
    );
    const store = useNoteDrafts.getState();
    await store.acquire('shared');
    await store.acquire('shared');
    store.edit('shared', 'draft');
    await expect(store.release('shared')).resolves.toBe(true);
    expect(saveMock).not.toHaveBeenCalled();
    expect(useNoteDrafts.getState().drafts['shared']).toMatchObject({ text: 'draft' });
    await expect(store.release('shared')).resolves.toBe(true);
    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(useNoteDrafts.getState().drafts['shared']).toBeUndefined();
  });

  it('returns false and keeps the dirty draft reachable when the release flush fails', async () => {
    installDela(
      async () => ({ ...content }),
      vi.fn(async () => {
        throw new Error('disk full');
      }),
    );
    const store = useNoteDrafts.getState();
    await store.acquire('dirty');
    store.edit('dirty', 'draft');
    await expect(store.release('dirty')).resolves.toBe(false);
    expect(useNoteDrafts.getState().drafts['dirty']).toMatchObject({
      text: 'draft',
      saving: false,
      error: 'disk full',
    });
  });

  it('returns true immediately for a clean or unknown draft', async () => {
    installDela(
      async () => ({ ...content }),
      vi.fn(async () => 'r2'),
    );
    const store = useNoteDrafts.getState();
    await expect(store.release('unknown')).resolves.toBe(true);
    await store.acquire('clean');
    await expect(store.release('clean')).resolves.toBe(true);
    expect(useNoteDrafts.getState().drafts['clean']).toBeUndefined();
  });

  it('does not inflate the refcount when a forced acquire refreshes from disk', async () => {
    let reads = 0;
    const { readMock } = installDela(
      async () => {
        reads += 1;
        return { ...content, text: reads === 1 ? 'old' : 'fresh' };
      },
      vi.fn(async () => 'r2'),
    );
    const store = useNoteDrafts.getState();
    await store.acquire('focus');
    // 窗口聚焦 / 会话终态刷新走 force：重读磁盘但不新增持有入口。
    await store.acquire('focus', true);
    await store.acquire('focus', true);
    expect(readMock).toHaveBeenCalledTimes(3);
    await expect(store.release('focus')).resolves.toBe(true);
    expect(useNoteDrafts.getState().drafts['focus']).toBeUndefined();
  });

  it('keeps the draft when it is re-acquired while the release flush is in flight', async () => {
    const finishes: ((revision: string) => void)[] = [];
    installDela(
      async () => ({ ...content }),
      () => new Promise<string>((resolve) => finishes.push(resolve)),
    );
    const store = useNoteDrafts.getState();
    await store.acquire('reopen');
    store.edit('reopen', 'draft');
    const releasing = store.release('reopen');
    // 冲盘 await 期间切回：新持有入口已计数，release 只冲盘不得删除。
    await store.acquire('reopen');
    finishes.shift()!('r2');
    await expect(releasing).resolves.toBe(true);
    expect(useNoteDrafts.getState().drafts['reopen']).toMatchObject({ text: 'draft' });
    await expect(store.release('reopen')).resolves.toBe(true);
    expect(useNoteDrafts.getState().drafts['reopen']).toBeUndefined();
  });
});
