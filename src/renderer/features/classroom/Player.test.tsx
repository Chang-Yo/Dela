// @vitest-environment jsdom
// 播放器续播回归：进入场次时恢复保存的秒数，暂停/播放中落盘，播完清除。
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ClassroomVideo, VideoCourse, VideoStream } from '../../../shared/vsjtu';
import { Player } from './Player';
import { readPlaybackProgress, savePlaybackProgress } from './progress';

const classroom = vi.hoisted(() => {
  const state = {
    streams: {} as Record<number, VideoStream[]>,
    streamsLoading: null as number | null,
    streamsError: {} as Record<number, string>,
    ensureStreams: vi.fn(),
    download: vi.fn(),
    seekRequest: null as { videoId: number; seconds: number } | null,
    playbackTime: 0,
  };
  return {
    state,
    getState: () => state,
    setState: (patch: Partial<typeof state>) => Object.assign(state, patch),
  };
});

vi.mock('./store', () => {
  const useClassroom = (selector: (state: typeof classroom.state) => unknown) =>
    selector(classroom.state);
  return {
    useClassroom: Object.assign(useClassroom, {
      getState: classroom.getState,
      setState: classroom.setState,
    }),
  };
});

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
  localStorage.clear();
  classroom.state.streams = {
    [video.id]: [{ view: 1, duration: 300, playbackUrl: 'dela-resource://vsjtu/video/11/1' }],
  };
  classroom.state.streamsLoading = null;
  classroom.state.streamsError = {};
  classroom.state.seekRequest = null;
  classroom.state.playbackTime = 0;
  classroom.state.ensureStreams.mockClear();
  classroom.state.download.mockClear();
  container = document.createElement('div');
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
});

async function renderPlayer() {
  await act(async () => root.render(<Player course={course} video={video} />));
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

it('offers a restart link that clears the saved position', async () => {
  savePlaybackProgress(video.id, 120);
  const element = await renderPlayer();
  await fire(element, 'loadedmetadata');
  const notice = container.querySelector('[role="status"]')!;
  const restart = [...notice.querySelectorAll('button')].find(
    (button) => button.textContent === '回到开头',
  );
  expect(restart).toBeDefined();
  await act(async () => restart!.click());
  expect(element.currentTime).toBe(0);
  expect(readPlaybackProgress(video.id)).toBeNull();
  expect(container.querySelector('[role="status"]')).toBeNull();
});

it('lets a transcript seek override the saved position', async () => {
  savePlaybackProgress(video.id, 120);
  classroom.state.seekRequest = { videoId: video.id, seconds: 60 };
  const element = await renderPlayer();
  await fire(element, 'loadedmetadata');
  expect(element.currentTime).toBe(60);
  expect(readPlaybackProgress(video.id)).toBe(60);
  expect(classroom.state.seekRequest).toBeNull();
});

it('saves the current second on pause and clears progress after the lecture ends', async () => {
  const element = await renderPlayer();
  element.currentTime = 45.8;
  await fire(element, 'pause');
  expect(readPlaybackProgress(video.id)).toBe(45);

  await fire(element, 'ended');
  expect(readPlaybackProgress(video.id)).toBeNull();
});

it('does not resume a lecture that was left in its last second', async () => {
  savePlaybackProgress(video.id, 299);
  const element = await renderPlayer();
  await fire(element, 'loadedmetadata');
  expect(element.currentTime).toBe(0);
  expect(readPlaybackProgress(video.id)).toBeNull();
});
