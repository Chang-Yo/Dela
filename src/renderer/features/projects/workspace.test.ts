import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspace } from './workspace';

const key = 'note-1';
const content = { title: 'Note', format: 'markdown' as const, text: 'old', revision: 'r1' };

function installWorkspace(
  saveNote: (id: string, text: string, revision: string) => Promise<string>,
) {
  const read = vi.fn(async () => ({ ...content }));
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      dela: {
        workspace: { read, saveNote },
        canvas: {},
      },
    },
  });
  useWorkspace.setState({
    drafts: {
      [key]: { content, text: 'old', saved: 'old', saving: false, error: null },
    },
  });
  return { read };
}

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  useWorkspace.setState({ drafts: {} });
});

beforeEach(() => vi.useFakeTimers());

describe('workspace draft persistence', () => {
  it('shares an in-flight save and persists the latest text observed before it finishes', async () => {
    const finishes: ((revision: string) => void)[] = [];
    const saveNote = vi.fn(() => new Promise<string>((resolve) => finishes.push(resolve)));
    installWorkspace(saveNote);
    useWorkspace.getState().edit(key, 'first');
    const first = useWorkspace.getState().save(key);
    useWorkspace.getState().edit(key, 'latest');
    const second = useWorkspace.getState().save(key);
    expect(second).toBe(first);
    finishes.shift()!('r2');
    await Promise.resolve();
    finishes.shift()!('r3');
    await first;
    expect(saveNote).toHaveBeenCalledTimes(2);
    expect(saveNote).toHaveBeenLastCalledWith(key, 'latest', 'r2');
    expect(useWorkspace.getState().drafts[key]).toMatchObject({
      text: 'latest',
      saved: 'latest',
      saving: false,
      error: null,
    });
  });

  it('resolves false on a failed save and retains the dirty draft for retry or recovery', async () => {
    const saveNote = vi.fn(async () => {
      throw new Error('disk full');
    });
    installWorkspace(saveNote);
    useWorkspace.getState().edit(key, 'draft');
    await expect(useWorkspace.getState().save(key)).resolves.toBe(false);
    expect(saveNote).toHaveBeenCalledTimes(1);
    expect(useWorkspace.getState().drafts[key]).toMatchObject({
      text: 'draft',
      saved: 'old',
      saving: false,
      error: 'disk full',
    });
  });

  it('keeps a newer edit when a forced read started before that edit', async () => {
    let finish!: (value: typeof content) => void;
    const read = vi.fn(() => new Promise<typeof content>((resolve) => (finish = resolve)));
    const saveNote = vi.fn(async () => 'r2');
    const { read: initialRead } = installWorkspace(saveNote);
    Object.defineProperty(window, 'dela', {
      configurable: true,
      value: { workspace: { read, saveNote }, canvas: {} },
    });
    const pending = useWorkspace.getState().read(key, true);
    useWorkspace.getState().edit(key, 'newer');
    finish({ ...content, text: 'from disk', revision: 'r3' });
    await pending;
    expect(initialRead).not.toHaveBeenCalled();
    expect(useWorkspace.getState().drafts[key]).toMatchObject({ text: 'newer', saved: 'old' });
  });
});
