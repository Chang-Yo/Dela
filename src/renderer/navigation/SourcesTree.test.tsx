// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CanvasState } from '../../shared/canvas';
import { useWorkspaceStore } from '../workspace/store';
import { SourcesTree } from './SourcesTree';

let root: Root;
let container: HTMLDivElement;
let canvas: CanvasState;
const syncCourse = vi.fn();

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  canvas = {
    connected: true,
    syncedAt: null,
    items: [],
    courses: [
      { id: 1, name: '历史课程', term: '2025-2026 Fall', code: '', syncedAt: null, error: null },
      { id: 2, name: '本学期课程', term: '2026-2027 Fall', code: '', syncedAt: null, error: null },
    ],
  };
  syncCourse.mockReset().mockImplementation(async () => canvas);
  Object.defineProperty(window, 'dela', { configurable: true, value: { canvas: { syncCourse } } });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  delete window.dela;
});

async function render() {
  useWorkspaceStore.setState({ canvas });
  await act(async () =>
    root.render(
      <SourcesTree
        expanded={['term:2025-2026 Fall']}
        onExpand={() => {}}
        onOpen={() => {}}
        selected={null}
        query=""
        bySource={false}
        archived
        onLink={() => {}}
      />,
    ),
  );
}

it.each([false, true])(
  'loads an archived-area course only on expansion (manual archive: %s)',
  async (archived) => {
    canvas.courses[0]!.archived = archived;
    await render();
    expect(syncCourse).not.toHaveBeenCalled();
    const item = [...container.querySelectorAll<HTMLElement>('[role="treeitem"]')].find(
      (item) => item.getAttribute('aria-label') === '历史课程',
    )!;
    expect(item).toBeDefined();
    await act(async () =>
      item.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })),
    );
    expect(syncCourse).toHaveBeenCalledExactlyOnceWith(1);
  },
);

it('reuses cached historical metadata on expansion', async () => {
  canvas.courses[0]!.syncedAt = '2026-01-01T00:00:00Z';
  await render();
  const item = [...container.querySelectorAll<HTMLElement>('[role="treeitem"]')].find(
    (item) => item.getAttribute('aria-label') === '历史课程',
  )!;
  await act(async () =>
    item.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })),
  );
  expect(syncCourse).not.toHaveBeenCalled();
});
