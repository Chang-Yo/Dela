import {
  inferSemesterStart,
  type SemesterRecording,
  type SemesterStartInference,
} from '../../shared/semester-start';
import { listCourses, listVideos } from '../vsjtu/api';

/**
 * 用本学期课堂录像反推开学日期：录像里最早的一节课所在周的周一即候选值。
 * 只产出候选与证据，不写库——推断可能偏晚，落库前须由用户确认。
 */
export async function inferSemesterStartFromVideos(
  semester: string,
  maxCourses = 12,
): Promise<SemesterStartInference> {
  const courses = await listCourses();
  const picked = courses.slice(0, maxCourses);
  const recordings: SemesterRecording[] = [];
  const failures: string[] = [];
  for (const course of picked) {
    try {
      for (const video of await listVideos(course.id))
        recordings.push({ courseId: course.id, courseName: course.name, start: video.start });
    } catch (error) {
      failures.push(`${course.name}：${error instanceof Error ? error.message : '录像读取失败'}`);
    }
  }
  if (picked.length && failures.length === picked.length)
    throw new Error(`课堂录像全部读取失败，无法推断开学日期（${failures[0]}）`);
  return { ...inferSemesterStart(semester, recordings), checkedCourses: picked.length, failures };
}
