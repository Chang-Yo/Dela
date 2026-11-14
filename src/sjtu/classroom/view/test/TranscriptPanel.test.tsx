// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { VideoTranscript } from '../../../shared/vsjtu';
import { TranscriptPanel } from './TranscriptPanel';
import { Player } from './Player';
import { useClassroom } from './store';

vi.mock('../../app/toasts', () => ({ showToast: vi.fn() }));
const transcript = {
  videoId: 11,
  segments: [
    { startMs: 3140, endMs: 10000, text: '工程伦理' },
    { startMs: 20000, endMs: 30000, text: '数据分析' },
  ],
};
const course = { id: 1, name: '测试课程', code: 'CS' };
const video = { id: 11, start: '2026-10-24 08:00:00', end: '09:00', period: '1', room: '' };
let root: Root;
let host: HTMLDivElement;
const load = vi.fn();
const save = vi.fn();
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  load.mockReset().mockResolvedValue(transcript);
  save.mockReset().mockResolvedValue({ saved: true });
  window.dela = {
    vsjtu: { transcript: load, exportTranscript: save },
  } as unknown as typeof window.dela;
  useClassroom.setState({
    courses: [course],
    videos: { 1: [video, { ...video, id: 12 }] },
    selectedCourseId: 1,
    selectedVideoId: 11,
    streams: { 11: [{ view: 1, duration: 100, playbackUrl: 'test.mp4' }] },
    seekRequest: null,
    playbackTime: 0,
  });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  delete window.dela;
  vi.unstubAllGlobals();
});

it('searches and highlights text, seeks after metadata arrives, and exports the complete lecture', async () => {
  await act(async () =>
    root.render(
      <>
        <TranscriptPanel />
        <Player course={course} video={video} />
      </>,
    ),
  );
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[aria-label="跳转到 0:20"]')!.click(),
  );
  expect(useClassroom.getState().seekRequest?.seconds).toBe(20);
  const media = host.querySelector('video')!;
  Object.defineProperty(media, 'duration', { value: 100 });
  await act(async () => media.dispatchEvent(new Event('loadedmetadata')));
  expect(media.currentTime).toBe(20);
  expect(useClassroom.getState().seekRequest).toBeNull();
  const input = host.querySelector('input[aria-label="搜索语音文稿"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '数据');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(host.querySelector('mark')?.textContent).toBe('数据');
  expect(host.querySelector('[aria-label="语音文稿"]')!.textContent).not.toContain('工程伦理');
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[aria-label="导出完整文稿"]')!.click(),
  );
  expect(save).toHaveBeenCalledWith(11, '测试课程 20261024 第1节');
});

it('discards a response after the selected lecture changes', async () => {
  let release!: (value: VideoTranscript) => void;
  load.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  await act(async () => root.render(<TranscriptPanel />));
  load.mockResolvedValueOnce(null);
  await act(async () => useClassroom.setState({ selectedVideoId: 12 }));
  await act(async () => release(transcript));
  expect(host.textContent).not.toContain('工程伦理');
  expect(host.querySelector<HTMLButtonElement>('[aria-label="导出完整文稿"]')!.disabled).toBe(true);
});
