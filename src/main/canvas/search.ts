import { likePattern, type SearchProvider } from '../../modules/search';
import { getDatabase } from '../database';

// 只匹配已缓存的课件文件名，搜索时不下载任何文件。
export const courseFileSearch: SearchProvider = {
  id: 'course-file',
  label: '课程资料',
  icon: 'file',
  search(query, limit) {
    const filter = query
      ? "AND json_extract(canvas_sources.data, '$.title') LIKE ? ESCAPE '!'"
      : '';
    const rows = getDatabase()
      .prepare(
        `SELECT canvas_sources.id, json_extract(canvas_sources.data, '$.title') AS title,
           json_extract(canvas_courses.data, '$.name') AS courseName
         FROM canvas_sources LEFT JOIN canvas_courses ON canvas_courses.id=canvas_sources.course_id
         WHERE json_extract(canvas_sources.data, '$.kind')='file' ${filter}
         ORDER BY canvas_sources.id LIMIT ?`,
      )
      .all(...(query ? [likePattern(query)] : []), limit) as {
      id: string;
      title: string;
      courseName: string | null;
    }[];
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      subtitle: row.courseName,
      target: { page: 'sources', sourceId: row.id },
    }));
  },
};
