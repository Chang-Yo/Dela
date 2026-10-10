// 课堂视频页状态：课程/录像/画面三级数据 + 下载任务镜像。
// 数据只经 window.dela.vsjtu 进入；请求守卫丢弃过期响应（与 shuiyuan/timetable 同款）。
import { create } from 'zustand';
import { showToast } from '../../app/toasts';
import type {
  ClassroomVideo,
  VideoCourse,
  VideoDownload,
  VideoStream,
} from '../../../shared/vsjtu';
import { errorText } from '../../workspace/store';
import { lectureFileName } from './player-format';
import { useExperimental } from '../settings/experimental';

export type ClassroomPhase = 'loading' | 'experimental' | 'connect' | 'ready';
/** 提示卡文案依据：总开关未开，还是子项未开。 */
export type ExperimentalOff = 'master' | 'classroom';

interface ClassroomState {
  phase: ClassroomPhase;
  /** 哪个试验开关未开启（phase 为 experimental 时的提示卡文案依据）。 */
  experimentalOff: ExperimentalOff;
  /** 连接卡上的失败原因（登录失败或首次查询失败）。 */
  connectHint: string | null;
  connectBusy: boolean;
  courses: VideoCourse[];
  coursesLoading: boolean;
  /** 已有课程时刷新失败的提示（不整页降级为连接卡）。 */
  coursesError: string | null;
  videos: Record<number, ClassroomVideo[]>;
  videosLoading: Record<number, boolean>;
  videosError: Record<number, string>;
  expanded: number | null;
  selectedCourseId: number | null;
  selectedVideoId: number | null;
  streams: Record<number, VideoStream[]>;
  /** 正在加载画面列表的 videoId（同时只有一个在途）。 */
  streamsLoading: number | null;
  streamsError: Record<number, string>;
  downloads: Record<string, VideoDownload>;
  init: () => Promise<void>;
  refresh: () => Promise<void>;
  connect: () => Promise<void>;
  toggleCourse: (courseId: number) => void;
  ensureVideos: (courseId: number) => Promise<void>;
  selectVideo: (courseId: number, videoId: number) => void;
  ensureStreams: (videoId: number) => Promise<VideoStream[] | null>;
  download: (courseName: string, video: ClassroomVideo, view: number) => Promise<void>;
  cancelDownload: (id: string) => void;
  revealDownload: (id: string) => void;
}

let coursesRequest = 0;
let videosRequest = 0;
let streamsRequest = 0;
let downloadSubscribed = false;

export const useClassroom = create<ClassroomState>((set, get) => ({
  phase: 'loading',
  experimentalOff: 'master',
  connectHint: null,
  connectBusy: false,
  courses: [],
  coursesLoading: false,
  coursesError: null,
  videos: {},
  videosLoading: {},
  videosError: {},
  expanded: null,
  selectedCourseId: null,
  selectedVideoId: null,
  streams: {},
  streamsLoading: null,
  streamsError: {},
  downloads: {},

  init: async () => {
    subscribeDownloads(set, get);
    // 与侧栏共用同一份试验开关镜像；总开关与子项都开启才进入。
    await useExperimental.getState().load();
    const { master, classroom } = useExperimental.getState();
    if (!master || !classroom) {
      set({ phase: 'experimental', experimentalOff: master ? 'classroom' : 'master' });
      return;
    }
    if (get().courses.length > 0) {
      set({ phase: 'ready' });
      return;
    }
    await get().refresh();
  },

  refresh: async () => {
    const request = ++coursesRequest;
    set({ coursesLoading: true });
    try {
      const courses = await window.dela!.vsjtu.listCourses();
      if (request !== coursesRequest) return;
      set({ phase: 'ready', courses, coursesLoading: false, coursesError: null });
      const { expanded } = get();
      const target =
        expanded !== null && courses.some((course) => course.id === expanded)
          ? expanded
          : (courses[0]?.id ?? null);
      if (target === null) {
        set({ expanded: null });
        return;
      }
      if (target !== expanded) get().toggleCourse(target);
      else void get().ensureVideos(target);
    } catch (error) {
      if (request !== coursesRequest) return;
      const hint = errorText(error);
      // 一门课都没有时才降级为连接卡；否则保留页面、列表内提示。
      if (get().courses.length === 0)
        set({ phase: 'connect', connectHint: hint, coursesLoading: false });
      else set({ coursesError: hint, coursesLoading: false });
    }
  },

  connect: async () => {
    set({ connectBusy: true, connectHint: null });
    try {
      const result = await window.dela!.vsjtu.connect();
      if (!result.ok) {
        set({ connectBusy: false, connectHint: result.error });
        return;
      }
    } catch (error) {
      set({ connectBusy: false, connectHint: errorText(error) });
      return;
    }
    set({ connectBusy: false });
    await get().refresh();
  },

  toggleCourse: (courseId) => {
    const { expanded } = get();
    const next = expanded === courseId ? null : courseId;
    set({ expanded: next });
    if (next !== null) void get().ensureVideos(next);
  },

  ensureVideos: async (courseId) => {
    if (get().videos[courseId]) return;
    const request = ++videosRequest;
    set({
      videosLoading: { ...get().videosLoading, [courseId]: true },
      videosError: { ...get().videosError, [courseId]: '' },
    });
    try {
      const videos = await window.dela!.vsjtu.listVideos(courseId);
      if (request !== videosRequest) return;
      set({
        videos: { ...get().videos, [courseId]: videos },
        videosLoading: { ...get().videosLoading, [courseId]: false },
      });
    } catch (error) {
      if (request !== videosRequest) return;
      set({
        videosLoading: { ...get().videosLoading, [courseId]: false },
        videosError: { ...get().videosError, [courseId]: errorText(error) },
      });
    }
  },

  selectVideo: (courseId, videoId) => {
    set({ selectedCourseId: courseId, selectedVideoId: videoId });
    void get().ensureStreams(videoId);
  },

  ensureStreams: async (videoId) => {
    const cached = get().streams[videoId];
    if (cached) return cached;
    const request = ++streamsRequest;
    set({
      streamsLoading: videoId,
      streamsError: { ...get().streamsError, [videoId]: '' },
    });
    try {
      const streams = await window.dela!.vsjtu.streams(videoId);
      if (request !== streamsRequest) return get().streams[videoId] ?? null;
      set({ streams: { ...get().streams, [videoId]: streams }, streamsLoading: null });
      return streams;
    } catch (error) {
      if (request !== streamsRequest) return null;
      set({
        streamsLoading: null,
        streamsError: { ...get().streamsError, [videoId]: errorText(error) },
      });
      return null;
    }
  },

  download: async (courseName, video, view) => {
    try {
      await window.dela!.vsjtu.download(video.id, view, lectureFileName(courseName, video));
    } catch (error) {
      showToast({ variant: 'error', title: '下载启动失败', description: errorText(error) });
    }
  },

  cancelDownload: (id) => {
    void window.dela!.vsjtu.cancelDownload(id).catch(() => {});
  },

  revealDownload: (id) => {
    void window.dela!.vsjtu.revealDownload(id).catch(() => {});
  },
}));

/** 订阅下载进度并拉取本次运行已存在的任务；整个应用只订阅一次。 */
function subscribeDownloads(
  set: (partial: Partial<ClassroomState>) => void,
  get: () => ClassroomState,
): void {
  if (downloadSubscribed) return;
  downloadSubscribed = true;
  void window
    .dela!.vsjtu.downloads()
    .then((list) => {
      set({ downloads: Object.fromEntries(list.map((download) => [download.id, download])) });
    })
    .catch(() => {});
  window.dela!.vsjtu.onDownload((info) => {
    const previous = get().downloads[info.id];
    if (info.state !== previous?.state) {
      if (info.state === 'completed')
        showToast({ variant: 'success', title: '下载完成', description: info.name });
      else if (info.state === 'interrupted')
        showToast({ variant: 'error', title: '下载中断', description: `${info.name}，请重新下载` });
    }
    set({ downloads: { ...get().downloads, [info.id]: info } });
  });
}
