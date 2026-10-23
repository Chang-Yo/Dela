// 课件文件的纯函数：@ 引用候选（canvas/api 与测试共用）与批量导出的「文件」分支收集。
import { posix, win32 } from 'node:path';
import type { SourceItem } from '../../shared/api';

/** @ 引用候选的一个课件文件：courseName/courseId 用于 title 生成与冲突消解。 */
export interface CourseRoot {
  courseName: string;
  courseId: number;
  /** 该课程在 courses 目录下的目录前缀（含 term 层）。 */
  root: string;
}

/** title 为「课程名/相对路径」；冲突（同名课程或同名相对路径）时课程名追加 [courseId]。 */
export function pickCourseFiles(
  roots: CourseRoot[],
  cachedPaths: string[],
  exists: (path: string) => boolean,
): { path: string; title: string }[] {
  const byTitle = new Map<string, { path: string; title: string }>();
  for (const path of cachedPaths) {
    if (!exists(path)) continue;
    for (const { root, courseName, courseId } of roots) {
      const paths = /^(?:[a-z]:[\\/]|\\\\)/i.test(root) ? win32 : posix;
      const relative = paths.relative(root, path);
      if (
        !relative ||
        relative === '..' ||
        relative.startsWith(`..${paths.sep}`) ||
        paths.isAbsolute(relative)
      )
        continue;
      const name = paths === win32 ? relative.replaceAll('\\', '/') : relative;
      let title = `${courseName}/${name}`;
      if (byTitle.has(title)) title = `${courseName} [${courseId}]/${name}`;
      // 再冲突（课程名本身形如「X [id]」且三方同相对路径）几乎不可达，放弃该文件而不是无限加后缀。
      if (!byTitle.has(title)) byTitle.set(title, { path, title });
      break;
    }
  }
  return [...byTitle.values()];
}

/** 「文件」分支下的一个课件：sourceId 取缓存，folders 为课程目录内的相对路径段。 */
export interface CourseFileEntry {
  sourceId: string;
  name: string;
  folders: string[];
}

/** 收集一门课程「文件」根目录（courseId:files）下的全部文件；模块、作业提交等
 *  重复引用不在根目录链上，天然被排除。 */
export function collectCourseFileEntries(courseId: number, items: SourceItem[]): CourseFileEntry[] {
  const rootId = `${courseId}:files`;
  const byId = new Map(items.map((item) => [item.id, item]));
  const entries = new Map<string, CourseFileEntry>();
  for (const item of items) {
    if (item.kind !== 'file' || !item.sourceId) continue;
    const folders: string[] = [];
    let inFiles = false;
    const seen = new Set<string>();
    for (let id = item.parentId; id && !seen.has(id); id = byId.get(id)?.parentId ?? null) {
      seen.add(id);
      if (id === rootId) {
        inFiles = true;
        break;
      }
      const parent = byId.get(id);
      if (!parent || !parent.id.startsWith('folder:')) break;
      folders.unshift(parent.name);
    }
    if (inFiles) entries.set(item.sourceId, { sourceId: item.sourceId, name: item.name, folders });
  }
  return [...entries.values()];
}
