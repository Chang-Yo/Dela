// 课堂视频（v.sjtu.edu.cn 交大视频）契约：类型与 preload 通道接口。
// 接口形态依据 2026-10-06 实测报告（课堂录像数据仅需校园 Cookie）；响应外层
// envelope 与列表行的字段名在主进程解析层做宽容处理，此处只暴露瘦身后的视图。

/** 连接与同步状态（vsjtu_sync 表只读视图 + authority/me 探活结果）。 */
export interface VsjtuState {
  readonly connected: boolean;
  readonly username: string | null;
  readonly lastSyncedAt: string | null;
  readonly error: string | null;
}

/** 有录播的教学班（课程栏条目；无录播的课程不出现在列表）。 */
export interface VsjtuCourse {
  readonly teclId: number;
  readonly subjCode: string | null;
  readonly subjName: string;
  readonly videoCount: number;
  readonly latestBeginTime: string | null;
}

/** 一场课堂录像（一次课的一节）。beginTime/endTime 为平台原始文本（如 "2026-09-24 14:00"）。 */
export interface VsjtuVideo {
  readonly courseId: number;
  readonly teclId: number;
  readonly beginTime: string;
  readonly endTime: string | null;
  readonly letiNumber: number | null;
  readonly classroom: string | null;
  readonly teacher: string | null;
  /** 时长（秒）。 */
  readonly vodTime: number | null;
  readonly thumbUrl: string | null;
  /** 逐句转写已生成（courTransferFlag）。 */
  readonly transferReady: boolean;
  /** PPT 切片已完成（coursePptSliceStatus = 5）。 */
  readonly pptReady: boolean;
}

/** 一路可播放画面；双路录像（教师/投影）以 viewNum 区分，URL 为带签名直链、免 Cookie。 */
export interface VsjtuPlayView {
  readonly viewNum: number;
  readonly url: string;
  readonly vodTime: number | null;
}

/** 播放信息：直链有有效期，每次播放现取、不缓存。 */
export interface VsjtuPlayInfo {
  readonly courseId: number;
  readonly views: readonly VsjtuPlayView[];
}

export interface VsjtuTranscriptLine {
  /** 相对视频起点的毫秒时间戳。 */
  readonly beginMs: number;
  readonly endMs: number;
  readonly text: string;
}

/** 知识点时间段（秒，含端点）。 */
export interface VsjtuTimeRange {
  readonly start: number;
  readonly end: number;
}

/** AI 知识点树节点（mindmap）：叶子时间段用于点击跳转。 */
export interface VsjtuChapterNode {
  readonly label: string;
  readonly ranges: readonly VsjtuTimeRange[];
  readonly children: readonly VsjtuChapterNode[];
}

/** PPT 逐页快照；seekTime 为该页翻页时间点（秒）。 */
export interface VsjtuPptPage {
  readonly index: number;
  readonly imageUrl: string;
  readonly ocrText: string | null;
  readonly seekTime: number | null;
}

export interface VsjtuList {
  readonly courses: readonly VsjtuCourse[];
  readonly videos: readonly VsjtuVideo[];
}

export type VsjtuResult = { ok: true } | { ok: false; error: string };

/** 加入项目时持久化的来源引用行（vsjtu_video_refs 表的视图；只存元数据，不存直链）。 */
export interface VsjtuSourceRef {
  readonly videoId: number;
  readonly title: string;
  readonly courseName: string | null;
  readonly beginTime: string | null;
  readonly letiNumber: number | null;
  readonly vodTime: number | null;
  readonly addedAt: string;
}

export interface VsjtuApi {
  /** 探活（authority/me）+ 本地同步状态；connected 为 false 时 UI 引导重新登录。 */
  getState(): Promise<VsjtuState>;
  /** 打开校园登录窗（v.sjtu 域），成功后返回 ok。 */
  login(): Promise<VsjtuResult>;
  /** 拉取课程与场次缓存；会话失效不清缓存，只记同步错误。 */
  sync(): Promise<VsjtuResult>;
  list(): Promise<VsjtuList>;
  /** 现取双路 MP4 直链（带签名、有有效期，不缓存）。 */
  getPlayInfo(courseId: number): Promise<VsjtuPlayInfo>;
  getTranscript(courseId: number): Promise<readonly VsjtuTranscriptLine[]>;
  getChapters(courseId: number): Promise<readonly VsjtuChapterNode[]>;
  getPpt(courseId: number): Promise<readonly VsjtuPptPage[]>;
  /** 写入来源引用行（添加到项目前调用）。 */
  addSourceRef(videoId: number): Promise<VsjtuSourceRef>;
  getSourceRef(videoId: number): Promise<VsjtuSourceRef | null>;
  /** 浏览器打开（仅 http(s)）。 */
  openLink(url: string): Promise<void>;
}
