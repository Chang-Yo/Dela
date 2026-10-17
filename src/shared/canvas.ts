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

/** 可识别学期按年份、季节降序并排在前面；同一时期或均无法识别时沿用名称降序。 */
export function compareCanvasTerms(a: string, b: string): number {
  const order = (term: string) => {
    const match = term.match(
      /(?:^|\D)(\d{4})(?:\s*-\s*(\d{4}))?\s*(?:学年|年)?[\s_]*(Fall|Spring|Summer|秋季?|春季?|夏季?)(?:学期)?\s*$/i,
    );
    if (!match) return 0;
    const start = Number(match[1]);
    const end = match[2] ? Number(match[2]) : start;
    if (match[2] && end !== start + 1) return 0;
    const season = /^(Fall|秋)/i.test(match[3]!) ? 2 : /^(Summer|夏)/i.test(match[3]!) ? 1 : 0;
    // 跨年学年的春夏属于后一年；单年份名称直接使用该年。
    return (season === 2 ? start : end) * 3 + season;
  };
  return order(b) - order(a) || b.localeCompare(a);
}

/** 取排序后的首个非「未标注学期」，供默认展开、刷新和 @ 候选共用。 */
export function latestTermOf(courses: { term: string }[]): string | undefined {
  return [...new Set(courses.map((c) => c.term))]
    .sort(compareCanvasTerms)
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
