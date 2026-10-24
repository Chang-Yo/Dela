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
  /** dela-resource 播放代理地址（token 在本次应用运行期间有效），renderer 只作 video.src 使用。 */
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
  transcript(videoId: number): Promise<VideoTranscript | null>;
  exportTranscript(videoId: number, title: string): Promise<{ saved: boolean }>;
  download(videoId: number, view: number, name: string): Promise<void>;
  downloads(): Promise<VideoDownload[]>;
  cancelDownload(id: string): Promise<void>;
  revealDownload(id: string): Promise<void>;
  /** 课堂录像的默认保存位置；空串 = 未设置。 */
  getDownloadDirectory(): Promise<string>;
  /** 选一个默认保存位置；取消时返回当前值。 */
  chooseDownloadDirectory(): Promise<string>;
  onDownload(listener: (download: VideoDownload) => void): () => void;
}
