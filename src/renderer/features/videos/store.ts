import { create } from 'zustand';
import type {
  VsjtuChapterNode,
  VsjtuCourse,
  VsjtuPptPage,
  VsjtuPlayInfo,
  VsjtuTranscriptLine,
  VsjtuVideo,
} from '../../../shared/api';
import { errorText } from '../../workspace/store';

/** 播放页右栏页签：M1 只有场次信息；章节/字幕/课件为 M2 复习面板。 */
export type ReviewTab = 'info' | 'chapters' | 'transcript' | 'ppt';

export interface PlayingState {
  video: VsjtuVideo;
  courseName: string;
  /** 播放直链现取（带签名、有有效期）；null 且 error 非空表示取链失败。 */
  info: VsjtuPlayInfo | null;
  infoError: string | null;
  /** 当前画面在 info.views 中的下标（双路切换保留进度由播放器组件负责）。 */
  viewIndex: number;
  tab: ReviewTab;
  transcript: {
    lines: readonly VsjtuTranscriptLine[] | null;
    loading: boolean;
    error: string | null;
  };
  chapters: { nodes: readonly VsjtuChapterNode[] | null; loading: boolean; error: string | null };
  ppt: { pages: readonly VsjtuPptPage[] | null; loading: boolean; error: string | null };
}

type Store = {
  connected: boolean;
  username: string | null;
  lastSyncedAt: string | null;
  syncError: string | null;
  syncing: boolean;
  courses: readonly VsjtuCourse[];
  videos: readonly VsjtuVideo[];
  /** null = 全部课程（按时间倒序混排）。 */
  activeTeclId: number | null;
  playing: PlayingState | null;
  /** 列表加载错误（openVideo 找不到场次等以横幅呈现）。 */
  openError: string | null;
  /** App 层「在课堂视频页打开」深链（项目树引用等），视图消费后清空。 */
  videoRequest: { videoId: number } | null;
  /** 加入项目弹窗。 */
  addOpen: boolean;

  init: () => Promise<void>;
  login: () => Promise<void>;
  sync: () => Promise<void>;
  reloadList: () => Promise<void>;
  selectCourse: (teclId: number | null) => void;
  openVideo: (videoId: number) => Promise<void>;
  closePlayer: () => void;
  setViewIndex: (index: number) => void;
  setTab: (tab: ReviewTab) => Promise<void>;
  requestVideo: (videoId: number) => void;
  consumeVideoRequest: () => void;
  openAddDialog: () => void;
  closeAddDialog: () => void;
};

/** 请求序号守卫（与水源/课表同法）：丢弃过期响应。 */
let playRequest = 0;
let reviewRequest = 0;
let syncRequest = 0;

export const useVideos = create<Store>((set, get) => {
  const courseNameOf = (teclId: number): string =>
    get().courses.find((course) => course.teclId === teclId)?.subjName ?? '课堂视频';

  /** 页签懒加载：切到页签才取对应复习数据，取过（含空结果/失败）不再自动重拉。 */
  const loadReview = async (tab: Exclude<ReviewTab, 'info'>): Promise<void> => {
    const api = window.dela?.vsjtu;
    const playing = get().playing;
    if (!api || !playing) return;
    const courseId = playing.video.courseId;
    /** 过期响应（换场次/关闭播放/切走页签）直接丢弃。 */
    const apply = (
      patch: PlayingState['transcript'] | PlayingState['chapters'] | PlayingState['ppt'],
      request: number,
      key: typeof tab,
    ) => {
      const current = get().playing;
      if (!current || reviewRequest !== request) return;
      set({ playing: { ...current, [key]: patch } });
    };
    const request = ++reviewRequest;
    const loading = (
      base: PlayingState['transcript'] | PlayingState['chapters'] | PlayingState['ppt'],
      key: typeof tab,
    ) => apply({ ...base, loading: true, error: null }, request, key);

    if (tab === 'transcript') {
      if (playing.transcript.loading || playing.transcript.lines !== null) return;
      loading(playing.transcript, tab);
      try {
        apply(
          { lines: await api.getTranscript(courseId), loading: false, error: null },
          request,
          tab,
        );
      } catch (error) {
        apply({ lines: [], loading: false, error: errorText(error) }, request, tab);
      }
      return;
    }
    if (tab === 'chapters') {
      if (playing.chapters.loading || playing.chapters.nodes !== null) return;
      loading(playing.chapters, tab);
      try {
        apply(
          { nodes: await api.getChapters(courseId), loading: false, error: null },
          request,
          tab,
        );
      } catch (error) {
        apply({ nodes: [], loading: false, error: errorText(error) }, request, tab);
      }
      return;
    }
    if (playing.ppt.loading || playing.ppt.pages !== null) return;
    loading(playing.ppt, tab);
    try {
      apply({ pages: await api.getPpt(courseId), loading: false, error: null }, request, tab);
    } catch (error) {
      apply({ pages: [], loading: false, error: errorText(error) }, request, tab);
    }
  };

  return {
    connected: false,
    username: null,
    lastSyncedAt: null,
    syncError: null,
    syncing: false,
    courses: [],
    videos: [],
    activeTeclId: null,
    playing: null,
    openError: null,
    videoRequest: null,
    addOpen: false,

    init: async () => {
      const api = window.dela?.vsjtu;
      if (!api) return;
      const state = await api.getState();
      set({
        connected: state.connected,
        username: state.username,
        lastSyncedAt: state.lastSyncedAt,
        syncError: state.error,
      });
      await get().reloadList();
      // 从未同步过且会话有效时自动拉一次；已有缓存则交给手动刷新（对齐课表模式）。
      if (state.connected && !state.lastSyncedAt) await get().sync();
    },

    login: async () => {
      const api = window.dela?.vsjtu;
      if (!api) return;
      set({ syncError: null });
      const result = await api.login();
      if (result.ok) {
        set({ connected: true });
        await get().sync();
      } else set({ syncError: result.error });
    },

    sync: async () => {
      const api = window.dela?.vsjtu;
      if (!api || get().syncing) return;
      const request = ++syncRequest;
      set({ syncing: true });
      const result = await api.sync();
      if (syncRequest !== request) return;
      // 成败都重探一次登录态；会话失效时主进程已保留缓存，这里只刷新提示。
      const state = await api.getState();
      set({
        syncing: false,
        connected: state.connected,
        lastSyncedAt: state.lastSyncedAt,
        syncError: result.ok ? null : result.error,
      });
      await get().reloadList();
    },

    reloadList: async () => {
      const api = window.dela?.vsjtu;
      if (!api) return;
      const list = await api.list();
      set({ courses: list.courses, videos: list.videos });
    },

    selectCourse: (teclId) => set({ activeTeclId: teclId }),

    openVideo: async (videoId) => {
      const api = window.dela?.vsjtu;
      if (!api) return;
      let video = get().videos.find((item) => item.courseId === videoId);
      if (!video) {
        // 深链可能先于列表缓存到达：先重读本地缓存再失败。
        await get().reloadList();
        video = get().videos.find((item) => item.courseId === videoId);
      }
      if (!video) {
        set({ openError: '该场次不在本地缓存中，请刷新后再试' });
        return;
      }
      set({ openError: null });
      const request = ++playRequest;
      reviewRequest += 1;
      const playing: PlayingState = {
        video,
        courseName: courseNameOf(video.teclId),
        info: null,
        infoError: null,
        viewIndex: 0,
        tab: 'info',
        transcript: { lines: null, loading: false, error: null },
        chapters: { nodes: null, loading: false, error: null },
        ppt: { pages: null, loading: false, error: null },
      };
      set({ playing });
      try {
        const info = await api.getPlayInfo(videoId);
        if (playRequest !== request || get().playing?.video.courseId !== videoId) return;
        set({ playing: { ...get().playing!, info, infoError: null, viewIndex: 0 } });
      } catch (error) {
        if (playRequest !== request || get().playing?.video.courseId !== videoId) return;
        set({ playing: { ...get().playing!, info: null, infoError: errorText(error) } });
      }
    },

    closePlayer: () => {
      playRequest += 1;
      reviewRequest += 1;
      set({ playing: null, addOpen: false });
    },

    setViewIndex: (index) => {
      const playing = get().playing;
      if (!playing?.info || index < 0 || index >= playing.info.views.length) return;
      if (index === playing.viewIndex) return;
      set({ playing: { ...playing, viewIndex: index } });
    },

    setTab: async (tab) => {
      const playing = get().playing;
      if (!playing || playing.tab === tab) return;
      set({ playing: { ...playing, tab } });
      if (tab !== 'info') await loadReview(tab);
    },

    requestVideo: (videoId) => set({ videoRequest: { videoId } }),
    consumeVideoRequest: () => set({ videoRequest: null }),
    openAddDialog: () => set({ addOpen: true }),
    closeAddDialog: () => set({ addOpen: false }),
  };
});
