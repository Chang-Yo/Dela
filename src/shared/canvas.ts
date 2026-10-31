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

/** 课程按学期分组：学期按 compareCanvasTerms 降序，组内按课程名排序；供批量导出弹窗等展示用。 */
export function groupCanvasCoursesByTerm(
  courses: CanvasCourse[],
): { term: string; courses: CanvasCourse[] }[] {
  const groups = new Map<string, CanvasCourse[]>();
  for (const course of courses) {
    const list = groups.get(course.term);
    if (list) list.push(course);
    else groups.set(course.term, [course]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => compareCanvasTerms(a, b))
    .map(([term, list]) => ({
      term,
      courses: list.sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id),
    }));
}

/** 已下载到本地 courses 目录的课件文件（@ 引用候选）：
 *  path 为本地绝对路径（模型用 read 读取），title 为「课程名/相对课程目录的路径」。 */
export interface CachedCourseFile {
  path: string;
  title: string;
}

export interface CanvasCacheCourse {
  id: number | null;
  name: string;
  fileCount: number;
  bytes: number;
  pinned: boolean;
}

export interface CanvasCacheTerm {
  term: string;
  fileCount: number;
  bytes: number;
  courses: CanvasCacheCourse[];
}

export interface CanvasCacheStats {
  directory: string;
  fileCount: number;
  bytes: number;
  terms: CanvasCacheTerm[];
  policy: CanvasCachePolicy;
  lastCleanupAt: string | null;
}

export interface CanvasCachePolicy {
  enabled: boolean;
  maxBytes: number;
  keepCurrentTerm: boolean;
}

export interface CanvasCachePins {
  fileIds: number[];
  courseIds: number[];
}

export type CanvasCachePinScope =
  { kind: 'file'; fileId: number } | { kind: 'course'; courseId: number };

export type CanvasCacheScope =
  { kind: 'all' } | { kind: 'term'; term: string } | { kind: 'course'; courseId: number };

export interface CanvasCacheClearResult {
  removedFiles: number;
  freedBytes: number;
  blockedFiles: number;
}

/** 批量导出的结果：exported 为成功写入目标目录的文件数，failed 为「课程/文件：原因」列表。 */
export interface CanvasExportResult {
  dir: string;
  exported: number;
  failed: string[];
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
  reveal(sourceId: string): Promise<void>;
  openLink(url: string): Promise<void>;
  getCacheStats(): Promise<CanvasCacheStats>;
  getCachePins(): Promise<CanvasCachePins>;
  updateCachePolicy(policy: CanvasCachePolicy): Promise<CanvasCacheStats>;
  setCachePin(scope: CanvasCachePinScope, pinned: boolean): Promise<CanvasCachePins>;
  clearCache(scope: CanvasCacheScope): Promise<CanvasCacheClearResult>;
  openCacheDirectory(): Promise<void>;
  /** 已下载到本地 courses 目录、属于最新学期（未归档）的课件文件列表。 */
  cachedFiles(): Promise<CachedCourseFile[]>;
  /** 批量导出所选课程「文件」目录下的全部课件；用户取消选择目标文件夹时返回 null。 */
  exportCourseFiles(courseIds: number[]): Promise<CanvasExportResult | null>;
  /** 订阅后台目录同步推送的课程状态；返回退订函数。 */
  onState(listener: (state: CanvasState) => void): () => void;
}
