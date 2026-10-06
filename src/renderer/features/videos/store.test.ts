// @vitest-environment jsdom
// 课堂视频 store：播放请求竞态守卫、页签懒加载只取一次、同步失败保留缓存、深链请求。
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VsjtuList, VsjtuPlayInfo, VsjtuResult, VsjtuState } from '../../../shared/api';

// store 动作里读 window.dela，先打桩再动态导入（与水源 store.test 同法）。
beforeEach(() => {
  vi.resetModules();
});

const state: VsjtuState = {
  connected: true,
  username: '胡同学',
  lastSyncedAt: '2026-10-06T08:00:00Z',
  error: null,
};

const list: VsjtuList = {
  courses: [
    {
      teclId: 9000,
      subjCode: 'CS3313',
      subjName: '计算理论',
      videoCount: 1,
      latestBeginTime: '2026-09-24 14:00:00',
    },
  ],
  videos: [
    {
      courseId: 153907,
      teclId: 9000,
      beginTime: '2026-09-24 14:00:00',
      endTime: null,
      letiNumber: 8,
      classroom: '东中院',
      teacher: null,
      vodTime: 3258,
      thumbUrl: null,
      transferReady: true,
      pptReady: true,
    },
  ],
};

function makeApi(overrides: Partial<Record<string, () => Promise<unknown>>> = {}) {
  const deferred: Array<(value: unknown) => void> = [];
  return {
    deferred,
    api: {
      getState: vi.fn(async (): Promise<VsjtuState> => state),
      login: vi.fn(async (): Promise<VsjtuResult> => ({ ok: true })),
      sync: vi.fn(async (): Promise<VsjtuResult> => ({ ok: true })),
      list: vi.fn(async (): Promise<VsjtuList> => list),
      getPlayInfo: vi.fn(
        (courseId: number): Promise<VsjtuPlayInfo> =>
          new Promise((resolve) =>
            deferred.push(() =>
              resolve({
                courseId,
                views: [{ viewNum: 1, url: `https://live/${courseId}.mp4`, vodTime: 3258 }],
              }),
            ),
          ),
      ),
      getTranscript: vi.fn(async () => [{ beginMs: 0, endMs: 1000, text: '开场' }]),
      getChapters: vi.fn(async () => []),
      getPpt: vi.fn(async () => []),
      addSourceRef: vi.fn(async () => ({})),
      getSourceRef: vi.fn(async () => null),
      openLink: vi.fn(async () => {}),
      ...overrides,
    },
  };
}

async function loadStore(api: unknown) {
  vi.stubGlobal('window', { dela: { vsjtu: api } });
  const { useVideos } = await import('./store');
  return useVideos;
}

describe('播放与竞态', () => {
  it('openVideo 取直链并落 playing；关闭播放后迟到的响应被丢弃', async () => {
    const { api, deferred } = makeApi();
    const useVideos = await loadStore(api);
    await useVideos.getState().init();
    const opening = useVideos.getState().openVideo(153907);
    deferred.shift()!(undefined);
    await opening;
    expect(useVideos.getState().playing?.info?.views[0]?.url).toContain('153907.mp4');

    // 再次打开但立即关闭：迟到解析的直链不得把播放页重新拉起。
    const reopening = useVideos.getState().openVideo(153907);
    useVideos.getState().closePlayer();
    deferred.shift()!(undefined);
    await reopening;
    expect(useVideos.getState().playing).toBeNull();
  });

  it('找不到场次时给出提示且不进入播放态', async () => {
    const { api } = makeApi();
    const useVideos = await loadStore(api);
    await useVideos.getState().init();
    await useVideos.getState().openVideo(404);
    expect(useVideos.getState().playing).toBeNull();
    expect(useVideos.getState().openError).toContain('不在本地缓存');
  });

  it('setViewIndex 越界忽略，边界内切换', async () => {
    const { api } = makeApi();
    api.getPlayInfo = vi.fn(async (): Promise<VsjtuPlayInfo> => ({
      courseId: 153907,
      views: [
        { viewNum: 1, url: 'https://live/a.mp4', vodTime: 1 },
        { viewNum: 5, url: 'https://live/b.mp4', vodTime: 1 },
      ],
    }));
    const useVideos = await loadStore(api);
    await useVideos.getState().init();
    await useVideos.getState().openVideo(153907);
    useVideos.getState().setViewIndex(5);
    expect(useVideos.getState().playing?.viewIndex).toBe(0);
    useVideos.getState().setViewIndex(1);
    expect(useVideos.getState().playing?.viewIndex).toBe(1);
  });
});

describe('页签懒加载', () => {
  it('切到字幕页签才拉转写，来回切换不重拉', async () => {
    const { api, deferred } = makeApi();
    const useVideos = await loadStore(api);
    await useVideos.getState().init();
    const opening = useVideos.getState().openVideo(153907);
    deferred.shift()!(undefined);
    await opening;
    await useVideos.getState().setTab('transcript');
    expect(api.getTranscript).toHaveBeenCalledTimes(1);
    expect(useVideos.getState().playing?.transcript.lines).toEqual([
      { beginMs: 0, endMs: 1000, text: '开场' },
    ]);
    await useVideos.getState().setTab('info');
    await useVideos.getState().setTab('transcript');
    expect(api.getTranscript).toHaveBeenCalledTimes(1);
  });

  it('章节接口失败时页签显示错误而不是空数据', async () => {
    const { api, deferred } = makeApi({
      getChapters: vi.fn(async () => Promise.reject(new Error('接口错误'))),
    });
    const useVideos = await loadStore(api);
    await useVideos.getState().init();
    const opening = useVideos.getState().openVideo(153907);
    deferred.shift()!(undefined);
    await opening;
    await useVideos.getState().setTab('chapters');
    expect(useVideos.getState().playing?.chapters.error).toBe('接口错误');
  });
});

describe('同步与会话', () => {
  it('同步失败保留缓存列表并记录错误', async () => {
    const { api } = makeApi({
      sync: vi.fn(async (): Promise<VsjtuResult> => ({
        ok: false,
        error: '校园会话已失效，请重新登录',
      })),
      getState: vi.fn(async (): Promise<VsjtuState> => ({
        ...state,
        connected: false,
        error: '校园会话已失效，请重新登录',
      })),
    });
    const useVideos = await loadStore(api);
    await useVideos.getState().init();
    await useVideos.getState().sync();
    expect(useVideos.getState().connected).toBe(false);
    expect(useVideos.getState().syncError).toContain('重新登录');
    expect(useVideos.getState().videos).toHaveLength(1);
  });

  it('首次同步在 init 内自动触发一次', async () => {
    const { api } = makeApi({
      getState: vi.fn(async (): Promise<VsjtuState> => ({ ...state, lastSyncedAt: null })),
    });
    const useVideos = await loadStore(api);
    await useVideos.getState().init();
    expect(api.sync).toHaveBeenCalledTimes(1);
  });
});
