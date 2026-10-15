import type { DocumentContent } from './documents';

export interface CanvasCourse {
  id: number;
  name: string;
  term: string;
  code: string;
  syncedAt: string | null;
  error: string | null;
  /** 已归档课程不再自动同步、不再提示同步错误，仅保留本地数据。 */
  archived?: boolean;
}

export interface SourceItem {
  id: string;
  parentId: string | null;
  courseId: number;
  name: string;
  kind: 'folder' | 'module' | 'file' | 'assignment' | 'page' | 'discussion' | 'link';
  sourceId: string | null;
  dueAt?: string | null;
}

export interface CanvasState {
  connected: boolean;
  syncedAt: string | null;
  courses: CanvasCourse[];
  items: SourceItem[];
}

/** 学期按名称降序取第一个非「未标注学期」，作为默认展开/刷新/@ 候选的「最新学期」。 */
export function latestTermOf(courses: { term: string }[]): string | undefined {
  return [...new Set(courses.map((c) => c.term))]
    .sort((a, b) => b.localeCompare(a))
    .find((term) => term !== '未标注学期');
}

/** 已下载到本地 courses 目录的课件文件（@ 引用候选）：
 *  path 为本地绝对路径（模型用 read 读取），title 为「课程名/相对课程目录的路径」。 */
export interface CachedCourseFile {
  path: string;
  title: string;
}

export interface CanvasApi {
  getState(): Promise<CanvasState>;
  configure(token: string): Promise<void>;
  disconnect(): Promise<void>;
  syncCourses(): Promise<CanvasState>;
  syncCourse(id: number): Promise<CanvasState>;
  archiveCourse(id: number, archived: boolean): Promise<CanvasState>;
  read(sourceId: string): Promise<DocumentContent>;
  download(sourceId: string): Promise<void>;
  openLink(url: string): Promise<void>;
  /** 已下载到本地 courses 目录、属于最新学期（未归档）的课件文件列表。 */
  cachedFiles(): Promise<CachedCourseFile[]>;
}
