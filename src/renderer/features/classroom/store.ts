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

export type ClassroomPhase = 'loading' | 'connect' | 'ready';

interface ClassroomState {
  phase: ClassroomPhase;
  connectBusy: boolean;
  courses: VideoCourse[];
  coursesLoading: boolean;
  videos: Record<number, ClassroomVideo[]>;
  videosLoading: Record<number, boolean>;
  videosError: Record<number, string>;
  selectedCourseId: number | null;
  selectedVideoId: number | null;
  seekRequest: { videoId: number; seconds: number } | null;
  playbackTime: number;
  seekTo: (videoId: number, seconds: number) => void;
  streams: Record<number, VideoStream[]>;
  /** 正在加载画面列表的 videoId（同时只有一个在途）。 */
  streamsLoading: number | null;
  streamsError: Record<number, string>;
  downloads: Record<string, VideoDownload>;
  init: () => Promise<void>;
  refresh: () => Promise<void>;
  connect: () => Promise<void>;
  selectCourse: (courseId: number) => void;
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
  connectBusy: false,
  courses: [],
  coursesLoading: false,
  videos: {},
  videosLoading: {},
  videosError: {},
  selectedCourseId: null,
  selectedVideoId: null,
  seekRequest: null,
  playbackTime: 0,
  seekTo: (videoId, seconds) => {
    if (get().selectedVideoId === videoId && Number.isFinite(seconds) && seconds >= 0)
      set({ seekRequest: { videoId, seconds } });
  },
  streams: {},
  streamsLoading: null,
  streamsError: {},
  downloads: {},

  init: async () => {
    subscribeDownloads(set, get);
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
      set({ phase: 'ready', courses, coursesLoading: false });
      const { selectedCourseId } = get();
      const target = courses.some((course) => course.id === selectedCourseId)
        ? selectedCourseId
        : (courses[0]?.id ?? null);
      if (target === null) {
        set({ selectedCourseId: null, selectedVideoId: null });
        return;
      }
      get().selectCourse(target);
    } catch (error) {
      if (request !== coursesRequest) return;
      // 一门课都没有时才降级为连接卡；否则保留页面，列表维持旧数据。失败原因走 toast。
      set(
        get().courses.length === 0
          ? { phase: 'connect', coursesLoading: false }
          : { coursesLoading: false },
      );
      showToast({ variant: 'error', title: '课程加载失败', description: errorText(error) });
    }
  },

  connect: async () => {
    set({ connectBusy: true });
    try {
      const result = await window.dela!.vsjtu.connect();
      if (!result.ok) {
        set({ connectBusy: false });
        showToast({ variant: 'error', title: '登录未完成', description: result.error });
        return;
      }
    } catch (error) {
      set({ connectBusy: false });
      showToast({ variant: 'error', title: '登录未完成', description: errorText(error) });
      return;
    }
    // 登录窗口完成后 busy 先解除；拉课程期间由 coursesLoading 驱动「正在获取视频列表…」。
    videosRequest++;
    streamsRequest++;
    set({
      connectBusy: false,
      courses: [],
      videos: {},
      videosLoading: {},
      videosError: {},
      streams: {},
      streamsLoading: null,
      streamsError: {},
      selectedCourseId: null,
      selectedVideoId: null,
    });
    await get().refresh();
  },

  selectCourse: (courseId) => {
    if (get().selectedCourseId !== courseId)
      set({
        selectedCourseId: courseId,
        selectedVideoId: null,
        seekRequest: null,
        playbackTime: 0,
      });
    void get().ensureVideos(courseId);
  },

  ensureVideos: async (courseId) => {
    if (get().videos[courseId] || get().videosLoading[courseId]) return;
    const request = videosRequest;
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
    set({
      selectedCourseId: courseId,
      selectedVideoId: videoId,
      seekRequest: null,
      playbackTime: 0,
    });
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
