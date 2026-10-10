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
export interface VideoStream {
  view: number;
  duration: number;
  /** dela-resource 播放代理地址（含一次性 token），renderer 只作 video.src 使用。 */
  playbackUrl: string;
}
export interface VideoDownload {
  id: string;
  name: string;
  received: number;
  total: number;
  state: 'progressing' | 'completed' | 'cancelled' | 'interrupted';
}
export interface VsjtuApi {
  connect(): Promise<{ ok: true } | { ok: false; error: string }>;
  listCourses(): Promise<VideoCourse[]>;
  listVideos(courseId: number): Promise<ClassroomVideo[]>;
  streams(videoId: number): Promise<VideoStream[]>;
  download(videoId: number, view: number, name: string): Promise<void>;
  downloads(): Promise<VideoDownload[]>;
  cancelDownload(id: string): Promise<void>;
  revealDownload(id: string): Promise<void>;
  onDownload(listener: (download: VideoDownload) => void): () => void;
}
