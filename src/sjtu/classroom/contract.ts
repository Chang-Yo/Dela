import { z } from 'zod';
import { defineContract } from '../../core/protocol/contract';

export interface VideoCourse {
  id: number;
  code: string;
  name: string;
}
export interface ClassroomVideo {
  id: number;
  start: string;
  end: string;
  room: string;
  period: string;
}
export interface TranscriptSegment {
  startMs: number;
  endMs: number;
  text: string;
}
export interface VideoTranscript {
  videoId: number;
  segments: TranscriptSegment[];
}
export interface VideoStream {
  view: number;
  duration: number;
  /** dela-resource 播放代理地址（token 在本次应用运行期间有效），界面只作 video.src 使用。 */
  playbackUrl: string;
}
export interface VideoDownload {
  id: string;
  name: string;
  received: number;
  total: number;
  state: 'progressing' | 'completed' | 'cancelled' | 'interrupted';
}

const id = z.number().int().positive();
const downloads = z.custom<VideoDownload[]>();

export const classroomContract = defineContract(
  'classroom',
  {
    /** 已连接 Canvas 时直接登录，否则在独立窗口登录交大视频。 */
    connect: {
      input: z.undefined(),
      output: z.custom<{ ok: true } | { ok: false; error: string }>(),
    },
    courses: { input: z.undefined(), output: z.custom<VideoCourse[]>() },
    videos: { input: id, output: z.custom<ClassroomVideo[]>() },
    streams: { input: id, output: z.custom<VideoStream[]>() },
    transcript: { input: id, output: z.custom<VideoTranscript | null>() },
    exportTranscript: {
      input: z.object({ videoId: id, title: z.string().trim().min(1).max(200) }),
      output: z.custom<{ saved: boolean }>(),
    },
    download: {
      input: z.object({ videoId: id, view: id, name: z.string().max(200) }),
      output: z.void(),
    },
    downloads: { input: z.undefined(), output: downloads },
    cancelDownload: { input: z.string(), output: z.void() },
    revealDownload: { input: z.string(), output: z.void() },
    /** 课堂录像的默认保存位置；空串表示未设置。 */
    downloadDirectory: { input: z.undefined(), output: z.string() },
    /** 选择默认保存位置；取消时返回当前值。 */
    chooseDownloadDirectory: { input: z.undefined(), output: z.string() },
  },
  {
    downloads,
    /** 某个下载完成或中断时推送一次，用于提示。 */
    downloadEnded: z.custom<VideoDownload>(),
  },
);

declare module '../../app/module' {
  interface NavTargets {
    classroom: {};
  }
}
