// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const course = { id: 1, name: '测试课程', code: 'CS' };
const video = { id: 11, start: '2026-10-24 08:00:00', end: '09:00', period: '1', room: '' };
// 契约客户端在模块加载时取 bridge，须先于导入视图装好。
const api = vi.hoisted(() => {
  const handlers: Record<string, (input: unknown) => Promise<unknown>> = {};
  window.dela = {
    bridge: {
      invoke: (channel: string, input: unknown) =>
        handlers[channel.slice('classroom:'.length)]!(input),
      subscribe: () => () => {},
    },
  } as unknown as NonNullable<typeof window.dela>;
  return handlers;
});
vi.mock('../../../../ui/toast', () => ({ showToast: vi.fn() }));
import { TranscriptPanel } from '../TranscriptPanel';
import { Player } from '../Player';
import { useClassroom } from '../store';

let root: Root;
let host: HTMLDivElement;
const save = vi.fn();
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  api.courses = async () => [course];
  api.videos = async () => [video];
  api.streams = async () => [{ view: 1, duration: 100, playbackUrl: 'test.mp4' }];
  api.transcript = async () => ({
    videoId: 11,
    segments: [
      { startMs: 3140, endMs: 10000, text: '工程伦理' },
      { startMs: 20000, endMs: 30000, text: '数据分析' },
    ],
  });
  api.exportTranscript = save.mockReset().mockResolvedValue({ saved: true });
  useClassroom.setState({ courseId: 1, videoId: 11, seekRequest: null, playbackTime: 0 });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

// 查询结果经定时器批量通知，链式读取（课程 → 录像 → 文稿）要多轮才落定。
async function settle() {
  for (let round = 0; round < 5; round++)
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
}

it('searches and highlights text, seeks after metadata arrives, and exports the complete lecture', async () => {
  await act(async () =>
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <TranscriptPanel />
        <Player course={course} video={video} />
      </QueryClientProvider>,
    ),
  );
  await settle();
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
  expect(save).toHaveBeenCalledWith({ videoId: 11, title: '测试课程 20261024 第1节' });
});
