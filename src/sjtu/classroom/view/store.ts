// 课堂视频页的界面状态：当前课程与场次、文稿发起的跳转、播放到的时刻；服务端数据在查询缓存。
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface ClassroomState {
  courseId: number | null;
  videoId: number | null;
  seekRequest: { videoId: number; seconds: number } | null;
  playbackTime: number;
  selectCourse: (courseId: number) => void;
  selectVideo: (courseId: number, videoId: number) => void;
  seekTo: (videoId: number, seconds: number) => void;
}

export const useClassroom = create<ClassroomState>((set, get) => ({
  courseId: null,
  videoId: null,
  seekRequest: null,
  playbackTime: 0,
  selectCourse: (courseId) => {
    if (get().courseId !== courseId)
      set({ courseId, videoId: null, seekRequest: null, playbackTime: 0 });
  },
  selectVideo: (courseId, videoId) =>
    set({ courseId, videoId, seekRequest: null, playbackTime: 0 }),
  seekTo: (videoId, seconds) => {
    if (get().videoId === videoId && Number.isFinite(seconds) && seconds >= 0)
      set({ seekRequest: { videoId, seconds } });
  },
}));

type ClassroomPreferences = { sidebarWidth: number; sidebarCollapsed: boolean };

export const useClassroomPreferences = create<ClassroomPreferences>()(
  persist((): ClassroomPreferences => ({ sidebarWidth: 300, sidebarCollapsed: false }), {
    name: 'dela.classroom.preferences',
    version: 1,
  }),
);
