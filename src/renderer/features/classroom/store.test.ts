// @vitest-environment jsdom
// 课堂视频连接流程：登录失败与课程拉取失败统一走 toast；登录成功后由
// coursesLoading 驱动「正在获取视频列表…」中间态，按钮不再退回「登录」。
import { beforeEach, expect, it, vi } from 'vitest';
import type { VsjtuApi } from '../../../shared/vsjtu';
import { useClassroom } from './store';
import type { ClassroomVideo } from '../../../shared/vsjtu';

const toast = vi.hoisted(() => vi.fn());
vi.mock('../../app/toasts', () => ({ showToast: toast }));

const vsjtu = {
  connect: vi.fn(),
  listCourses: vi.fn(),
  listVideos: vi.fn(async () => [] as ClassroomVideo[]),
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
  vsjtu.listCourses.mockReset().mockImplementation(async () => useClassroom.getState().courses);
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
    selectedCourseKey: null,
    selectedVideoId: null,
  });
});

it('同一个数字的 Canvas ID 和视频教学班 ID 保持独立选择和录像缓存', async () => {
  useClassroom.setState({
    courses: [
      { id: 42, name: '物理', code: 'PHYS-07', source: 'canvas' },
      { id: 42, name: '另一门课', code: 'OTHER' },
    ],
  });
  await useClassroom.getState().ensureVideos('canvas:42');
  await useClassroom.getState().ensureVideos('video:42');
  expect(vsjtu.listVideos.mock.calls).toEqual([
    [42, 'canvas'],
    [42, undefined],
  ]);
  expect(useClassroom.getState().videos).toEqual({ 'canvas:42': [], 'video:42': [] });
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
    selectedCourseKey: 'video:1',
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
  await useClassroom.getState().ensureVideos('video:1');
  await useClassroom.getState().ensureVideos('video:1');
  expect(useClassroom.getState()).toMatchObject({
    phase: 'ready',
    videos: { 'video:1': [] },
    videosLoading: { 'video:1': false },
    videosError: { 'video:1': '' },
  });
  expect(vsjtu.listVideos).toHaveBeenCalledTimes(1);
  expect(toast).not.toHaveBeenCalled();
});

it('Canvas 课程查询录像时保留来源，避免把 Canvas ID 当成教学班 ID', async () => {
  useClassroom.setState({ courses: [{ id: 42, code: 'PHYS', name: '物理', source: 'canvas' }] });
  await useClassroom.getState().ensureVideos('canvas:42');
  expect(vsjtu.listVideos).toHaveBeenCalledWith(42, 'canvas');
});

it('同一来源刷新课程列表时保留已选录像及缓存', async () => {
  const course = { id: 42, code: 'PHYS', name: '物理', source: 'canvas' as const };
  const videos = [{ id: 7, start: '', end: '', room: '', period: '' }];
  useClassroom.setState({
    courses: [course],
    selectedCourseKey: 'canvas:42',
    selectedVideoId: 7,
    videos: { 'canvas:42': videos },
  });
  vsjtu.listCourses.mockResolvedValue([course]);
  await useClassroom.getState().refresh();
  expect(useClassroom.getState().selectedVideoId).toBe(7);
  expect(useClassroom.getState().videos['canvas:42']).toEqual(videos);
  expect(vsjtu.listVideos).not.toHaveBeenCalled();
});

it('合并同一教学班的课表入口时保留正在播放的录像', async () => {
  const canvasCourse = { id: 42, name: '物理', code: 'PHYS-07', source: 'canvas' as const };
  const videos = [{ id: 7, start: '', end: '', room: '', period: '' }];
  useClassroom.setState({
    courses: [canvasCourse, { id: 9001, name: '物理', code: 'PHYS' }],
    selectedCourseKey: 'video:9001',
    selectedVideoId: 7,
    videos: { 'video:9001': videos },
  });
  vsjtu.listCourses.mockResolvedValue([{ ...canvasCourse, teachingClassId: 9001 }]);
  await useClassroom.getState().refresh();
  expect(useClassroom.getState()).toMatchObject({
    selectedCourseKey: 'canvas:42',
    selectedVideoId: 7,
    videos: { 'canvas:42': videos },
  });
  expect(vsjtu.listVideos).not.toHaveBeenCalled();
});

it('移除尚无教学班映射的课程时不把录像转移到其他课程', async () => {
  useClassroom.setState({
    courses: [{ id: 42, name: '物理', code: 'PHYS', source: 'canvas' }],
    selectedCourseKey: 'canvas:42',
    selectedVideoId: 7,
    videos: { 'canvas:42': [{ id: 7, start: '', end: '', room: '', period: '' }] },
  });
  vsjtu.listCourses.mockResolvedValue([{ id: 43, name: '数学', code: 'MATH', source: 'canvas' }]);
  await useClassroom.getState().refresh();
  expect(useClassroom.getState().selectedVideoId).toBeNull();
  expect(useClassroom.getState().videos['canvas:43']).not.toContainEqual(
    expect.objectContaining({ id: 7 }),
  );
});

it('刷新切换到 Canvas 来源时丢弃旧来源同号课程的录像与在途结果', async () => {
  let finish!: (videos: ClassroomVideo[]) => void;
  vsjtu.listVideos.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
  useClassroom.setState({ courses: [{ id: 42, code: 'OLD', name: '旧课程' }] });
  const pending = useClassroom.getState().ensureVideos('video:42');
  vsjtu.listCourses.mockResolvedValue([
    { id: 42, code: 'PHYS', name: 'Canvas 课程', source: 'canvas' },
  ]);
  await useClassroom.getState().refresh();
  await vi.waitFor(() => expect(vsjtu.listVideos).toHaveBeenCalledWith(42, 'canvas'));
  finish([{ id: 7, start: '', end: '', room: '', period: '' }]);
  await pending;
  expect(useClassroom.getState().videos['canvas:42']).toEqual([]);
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
  useClassroom.setState({
    courses: [1, 2, 3].map((id) => ({ id, code: 'CS', name: `课程${id}` })),
    selectedCourseKey: 'video:1',
    selectedVideoId: 11,
  });
  useClassroom.getState().selectCourse('video:2');
  expect(useClassroom.getState().selectedVideoId).toBeNull();
  useClassroom.getState().selectCourse('video:3');
  await vi.waitFor(() => expect(useClassroom.getState().videos['video:3']).toEqual([]));
  first([]);
  await vi.waitFor(() => expect(useClassroom.getState().videosLoading['video:2']).toBe(false));
  expect(useClassroom.getState().selectedCourseKey).toBe('video:3');
  useClassroom.getState().selectCourse('video:2');
  expect(vsjtu.listVideos).toHaveBeenCalledTimes(2);
  expect(vsjtu.streams).not.toHaveBeenCalled();
});
