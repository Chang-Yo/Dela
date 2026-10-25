// @vitest-environment jsdom
// 课堂视频连接流程：登录失败与课程拉取失败统一走 toast；登录成功后由
// coursesLoading 驱动「正在获取视频列表…」中间态，按钮不再退回「登录」。
import { beforeEach, expect, it, vi } from 'vitest';
import type { VsjtuApi } from '../../../shared/vsjtu';
import { useClassroom } from './store';

const toast = vi.hoisted(() => vi.fn());
vi.mock('../../app/toasts', () => ({ showToast: toast }));

const vsjtu = {
  connect: vi.fn(),
  listCourses: vi.fn(),
  listVideos: vi.fn(async () => []),
  streams: vi.fn(async () => []),
  transcript: vi.fn(async () => null),
  exportTranscript: vi.fn(async () => ({ saved: false })),
  download: vi.fn(async () => {}),
  downloads: vi.fn(async () => []),
  cancelDownload: vi.fn(async () => {}),
  revealDownload: vi.fn(async () => {}),
  getDownloadDirectory: vi.fn(async () => ''),
  chooseDownloadDirectory: vi.fn(async () => ''),
  onDownload: vi.fn(() => () => {}),
} satisfies VsjtuApi;

beforeEach(() => {
  toast.mockClear();
  vsjtu.connect.mockReset();
  vsjtu.listCourses.mockReset();
  vsjtu.listVideos.mockReset().mockResolvedValue([]);
  window.dela = { vsjtu } as unknown as typeof window.dela;
  useClassroom.setState({
    phase: 'connect',
    connectBusy: false,
    courses: [],
    coursesLoading: false,
    videos: {},
    videosLoading: {},
    videosError: {},
    selectedCourseId: null,
    selectedVideoId: null,
  });
});

it('登录未完成或抛错时弹错误 toast 并解除 busy', async () => {
  vsjtu.connect.mockResolvedValueOnce({ ok: false, error: '官方窗口已关闭' });
  await useClassroom.getState().connect();
  expect(toast).toHaveBeenCalledWith({
    variant: 'error',
    title: '登录未完成',
    description: '官方窗口已关闭',
  });
  vsjtu.connect.mockRejectedValueOnce(new Error('IPC 不可用'));
  await useClassroom.getState().connect();
  expect(toast).toHaveBeenLastCalledWith({
    variant: 'error',
    title: '登录未完成',
    description: 'IPC 不可用',
  });
  expect(useClassroom.getState().connectBusy).toBe(false);
  expect(useClassroom.getState().phase).toBe('connect');
});

it('登录成功后先停在获取课程列表阶段，完成后进入就绪', async () => {
  vsjtu.connect.mockResolvedValue({ ok: true });
  let resolveCourses: (courses: { id: number; code: string; name: string }[]) => void;
  vsjtu.listCourses.mockImplementation(() => new Promise((resolve) => (resolveCourses = resolve)));
  const done = useClassroom.getState().connect();
  // 登录窗口阶段结束、课程仍在途：连接卡应显示「正在获取视频列表…」而不是退回「登录」。
  await vi.waitFor(() => expect(useClassroom.getState().coursesLoading).toBe(true));
  expect(useClassroom.getState().connectBusy).toBe(false);
  expect(useClassroom.getState().phase).toBe('connect');
  resolveCourses!([]);
  await done;
  expect(useClassroom.getState().phase).toBe('ready');
  expect(useClassroom.getState().coursesLoading).toBe(false);
  expect(toast).not.toHaveBeenCalled();
});

it('课程加载失败且无已有课程时降级连接卡并弹 toast', async () => {
  useClassroom.setState({ phase: 'loading', courses: [] });
  vsjtu.listCourses.mockRejectedValue(new Error('校园会话失效'));
  await useClassroom.getState().refresh();
  expect(useClassroom.getState().phase).toBe('connect');
  expect(useClassroom.getState().coursesLoading).toBe(false);
  expect(toast).toHaveBeenCalledWith({
    variant: 'error',
    title: '课程加载失败',
    description: '校园会话失效',
  });
});

it('已有课程时刷新失败保留页面并弹 toast', async () => {
  useClassroom.setState({ phase: 'ready', courses: [{ id: 1, code: 'CS', name: '课程一' }] });
  vsjtu.listCourses.mockRejectedValue(new Error('网络中断'));
  await useClassroom.getState().refresh();
  expect(useClassroom.getState().phase).toBe('ready');
  expect(useClassroom.getState().courses).toHaveLength(1);
  expect(toast).toHaveBeenCalledWith({
    variant: 'error',
    title: '课程加载失败',
    description: '网络中断',
  });
});

it('成功空课程保持就绪且不再请求录像或重新登录', async () => {
  useClassroom.setState({
    phase: 'ready',
    courses: [{ id: 1, code: 'CS', name: '课程一' }],
    selectedCourseId: 1,
  });
  vsjtu.listCourses.mockResolvedValue([]);
  await useClassroom.getState().refresh();
  expect(useClassroom.getState()).toMatchObject({
    phase: 'ready',
    courses: [],
    coursesLoading: false,
  });
  expect(vsjtu.connect).not.toHaveBeenCalled();
  expect(vsjtu.listVideos).not.toHaveBeenCalled();
  expect(toast).not.toHaveBeenCalled();
});

it('成功空录像作为已加载结果保存，再次展开不重复请求', async () => {
  useClassroom.setState({ phase: 'ready', courses: [{ id: 1, code: 'CS', name: '课程一' }] });
  await useClassroom.getState().ensureVideos(1);
  await useClassroom.getState().ensureVideos(1);
  expect(useClassroom.getState()).toMatchObject({
    phase: 'ready',
    videos: { 1: [] },
    videosLoading: { 1: false },
    videosError: { 1: '' },
  });
  expect(vsjtu.listVideos).toHaveBeenCalledTimes(1);
  expect(toast).not.toHaveBeenCalled();
});

it('切换课程清空当前节次，交错完成的录像请求仍正确缓存且不自动播放', async () => {
  let first!: (videos: []) => void;
  vsjtu.listVideos.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        first = resolve;
      }),
  );
  vsjtu.streams.mockClear();
  useClassroom.setState({ selectedCourseId: 1, selectedVideoId: 11 });
  useClassroom.getState().selectCourse(2);
  expect(useClassroom.getState().selectedVideoId).toBeNull();
  useClassroom.getState().selectCourse(3);
  await vi.waitFor(() => expect(useClassroom.getState().videos[3]).toEqual([]));
  first([]);
  await vi.waitFor(() => expect(useClassroom.getState().videosLoading[2]).toBe(false));
  expect(useClassroom.getState().selectedCourseId).toBe(3);
  useClassroom.getState().selectCourse(2);
  expect(vsjtu.listVideos).toHaveBeenCalledTimes(2);
  expect(vsjtu.streams).not.toHaveBeenCalled();
});
