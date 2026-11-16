// @vitest-environment jsdom
// 播放器续播回归：进入场次时恢复保存的秒数，暂停/播放中落盘，播完清除。
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ClassroomVideo, VideoCourse } from '../../contract';

// 契约客户端在模块加载时取 bridge，须先于导入视图装好。
vi.hoisted(() => {
  window.dela = {
    bridge: {
      invoke: async () => [
        { view: 1, duration: 300, playbackUrl: 'dela-resource://vsjtu/video/11/1' },
      ],
      subscribe: () => () => {},
    },
  } as unknown as NonNullable<typeof window.dela>;
});
import { Player } from '../Player';
import { readPlaybackProgress, savePlaybackProgress } from '../progress';
import { useClassroom } from '../store';

const course: VideoCourse = { id: 9000, code: 'CS3313', name: '计算理论' };
const video: ClassroomVideo = {
  id: 11,
  start: '2026-10-16 08:00:00',
  end: '2026-10-16 08:45:00',
  room: '东上院405',
  period: '1',
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  localStorage.clear();
  useClassroom.setState({ videoId: video.id, seekRequest: null, playbackTime: 0 });
  container = document.createElement('div');
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

// 查询结果经定时器批量通知，链式读取（课程 → 录像 → 文稿）要多轮才落定。
async function settle() {
  for (let round = 0; round < 5; round++)
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
}

async function renderPlayer() {
  await act(async () =>
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <Player course={course} video={video} />
      </QueryClientProvider>,
    ),
  );
  await settle();
  const element = container.querySelector('video')!;
  Object.defineProperty(element, 'duration', { configurable: true, value: 300 });
  return element;
}

async function fire(element: HTMLVideoElement, type: string) {
  await act(async () => element.dispatchEvent(new Event(type)));
}

it('restores a saved position when metadata is ready', async () => {
  savePlaybackProgress(video.id, 120);
  const element = await renderPlayer();
  await fire(element, 'loadedmetadata');
  expect(element.currentTime).toBe(120);
  expect(container.querySelector('[role="status"]')?.textContent).toContain('2:00');
});

it('lets a transcript seek override the saved position', async () => {
  savePlaybackProgress(video.id, 120);
  useClassroom.setState({ seekRequest: { videoId: video.id, seconds: 60 } });
  const element = await renderPlayer();
  await fire(element, 'loadedmetadata');
  expect(element.currentTime).toBe(60);
  expect(readPlaybackProgress(video.id)).toBe(60);
  expect(useClassroom.getState().seekRequest).toBeNull();
});

it('saves the current second on pause and clears progress after the lecture ends', async () => {
  const element = await renderPlayer();
  element.currentTime = 45.8;
  await fire(element, 'pause');
  expect(readPlaybackProgress(video.id)).toBe(45);

  await fire(element, 'ended');
  expect(readPlaybackProgress(video.id)).toBeNull();
});
