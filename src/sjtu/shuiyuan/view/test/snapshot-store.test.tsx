// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import type { ShuiyuanSnapshotState } from '../../../shared/api';
import {
  subscribeShuiyuanSnapshots,
  useShuiyuanSnapshots,
  useShuiyuanSnapshotBadges,
  useShuiyuanSourceRef,
} from './snapshot-store';

it('updates only subscribed topics and only changes tree badges when the percentage changes', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let notify!: (state: ShuiyuanSnapshotState) => void;
  window.dela = {
    shuiyuan: {
      onSnapshot: (listener: typeof notify) => {
        notify = listener;
        return () => {};
      },
      getSourceRef: async () => null,
    },
  } as never;
  const stop = subscribeShuiyuanSnapshots();
  let readerRenders = 0;
  let treeRenders = 0;
  function Reader() {
    useShuiyuanSnapshots([42]);
    readerRenders++;
    return null;
  }
  function Tree() {
    useShuiyuanSnapshotBadges([42]);
    treeRenders++;
    return null;
  }
  const root = createRoot(document.createElement('div'));
  await act(async () =>
    root.render(
      <>
        <Reader />
        <Tree />
      </>,
    ),
  );
  const initialReader = readerRenders;
  const initialTree = treeRenders;
  const state = (topicId: number, done: number): ShuiyuanSnapshotState => ({
    topicId,
    status: 'saving',
    savedAt: null,
    error: null,
    progress: { phase: 'images', done, total: 50000, cachedAt: null },
  });
  await act(async () => notify(state(99, 1)));
  expect(readerRenders).toBe(initialReader);
  expect(treeRenders).toBe(initialTree);
  await act(async () => notify(state(42, 1)));
  const treeAtZero = treeRenders;
  await act(async () => notify(state(42, 2)));
  expect(readerRenders).toBe(initialReader + 2);
  expect(treeRenders).toBe(treeAtZero);
  await act(async () => notify(state(42, 500)));
  expect(treeRenders).toBe(treeAtZero + 1);
  await act(async () => root.unmount());
  stop?.();
  vi.unstubAllGlobals();
});

it('shares source initialization and preserves progress received before the response', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let notify!: (state: ShuiyuanSnapshotState) => void;
  let resolve!: (value: unknown) => void;
  const getSourceRef = vi.fn(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  window.dela = {
    shuiyuan: {
      getSourceRef,
      onSnapshot: (listener: typeof notify) => {
        notify = listener;
        return () => {};
      },
    },
  } as never;
  const stop = subscribeShuiyuanSnapshots();
  function Reader() {
    const title = useShuiyuanSourceRef(123)?.title;
    const done = useShuiyuanSnapshots([123])[123]?.progress?.done;
    return (
      <span>
        {title}:{done}
      </span>
    );
  }
  function Tree() {
    useShuiyuanSnapshotBadges([123]);
    return null;
  }
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () =>
    root.render(
      <>
        <Reader />
        <Tree />
      </>,
    ),
  );
  expect(getSourceRef).toHaveBeenCalledExactlyOnceWith(123);
  await act(async () =>
    notify({
      topicId: 123,
      status: 'saving',
      savedAt: null,
      error: null,
      progress: { phase: 'images', done: 5, total: 10, cachedAt: null },
    }),
  );
  await act(async () => resolve({ title: '共享元数据', snapshot: null }));
  expect(container.textContent).toBe('共享元数据:5');
  await act(async () => root.unmount());
  stop?.();
  vi.unstubAllGlobals();
});
