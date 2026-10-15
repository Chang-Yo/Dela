// 课件缓存文件的 @ 引用候选（纯函数，无 electron/db 依赖，供 canvas/api 与测试共用）。
import { resolve } from 'node:path';

/** @ 引用候选的一个课件文件：courseName/courseId 用于 title 生成与冲突消解。 */
export interface CourseRoot {
  courseName: string;
  courseId: number;
  /** 该课程在 courses 目录下的目录前缀（含 term 层）。 */
  root: string;
}

/** 从缓存路径清单里挑出位于任一课程目录之下的文件，title 为「课程名/相对路径」，
 *  冲突（同名课程或同名相对路径）时课程名追加 [courseId]。 */
export function pickCourseFiles(
  roots: CourseRoot[],
  cachedPaths: string[],
  exists: (path: string) => boolean,
): { path: string; title: string }[] {
  const byTitle = new Map<string, { path: string; title: string }>();
  for (const path of cachedPaths) {
    if (!exists(path)) continue;
    const resolved = resolve(path);
    const hit = roots.find(({ root }) => {
      const base = resolve(root).toLowerCase();
      const lower = resolved.toLowerCase();
      return lower.startsWith(`${base}\\`) || lower.startsWith(`${base}/`);
    });
    if (!hit) continue;
    const relative = resolved.slice(resolve(hit.root).length + 1).replaceAll('\\', '/');
    let title = `${hit.courseName}/${relative}`;
    if (byTitle.has(title)) title = `${hit.courseName} [${hit.courseId}]/${relative}`;
    // 再冲突（课程名本身形如「X [id]」且三方同相对路径）几乎不可达，放弃该文件而不是无限加后缀。
    if (!byTitle.has(title)) byTitle.set(title, { path, title });
  }
  return [...byTitle.values()];
}
