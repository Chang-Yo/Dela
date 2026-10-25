import { stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { z } from 'zod';
import {
  formatSegments,
  formatTranscript,
  getTranscript,
  listCourses,
  listVideos,
} from '../../../vsjtu/api';
import { safeFileName } from '../../../vsjtu/transcript';
import { limit, match, offset, page, query, tool } from '../shared';

const id = z.number().int().positive();

export const classroomTools = {
  list_classroom_courses: tool(
    '联网列出本学期课堂视频课程，返回教学班 ID。需要先在课堂视频页面登录。',
    z.object({ query, offset, limit }).strict(),
    async ({ query, offset, limit }) =>
      page(
        (await listCourses()).filter((course) => match(`${course.name} ${course.code}`, query)),
        offset,
        limit,
      ),
  ),
  list_classroom_videos: tool(
    '联网列出指定教学班的录像节次；返回的录像 id 用于读取或下载语音文稿。',
    z.object({ courseId: id, offset, limit }).strict(),
    async ({ courseId, offset, limit }) => page(await listVideos(courseId), offset, limit),
  ),
  read_classroom_transcript: tool(
    '读取录像时间范围内的语音文稿，不写文件、不要求工作区。时间单位为秒，默认读取前五分钟；包含与区间重叠的完整段落，正文按字符分页，nextOffset 用于同一区间续读。',
    z
      .object({
        videoId: id,
        startSeconds: z.number().nonnegative().default(0),
        endSeconds: z.number().positive().optional(),
        offset,
        limit: z.number().int().min(1).max(12000).default(6000),
      })
      .strict(),
    async ({ videoId, startSeconds, endSeconds = startSeconds + 300, offset, limit }) => {
      if (endSeconds <= startSeconds) throw new Error('结束时间必须晚于开始时间');
      const transcript = await getTranscript(videoId);
      const segments =
        transcript?.segments.filter(
          (segment) => segment.endMs > startSeconds * 1000 && segment.startMs < endSeconds * 1000,
        ) ?? [];
      const text = segments.length ? formatSegments(segments) : '';
      return {
        videoId,
        available: transcript !== null,
        startSeconds,
        endSeconds,
        text: text.slice(offset, offset + limit),
        totalCharacters: text.length,
        nextOffset: offset + limit < text.length ? offset + limit : null,
        nextStartSeconds: transcript?.segments.some((segment) => segment.endMs > endSeconds * 1000)
          ? endSeconds
          : null,
      };
    },
  ),
  download_classroom_transcripts: tool(
    '将同一课程中选定节次的完整文稿逐节保存为 TXT，返回各项结果，不返回正文。必须明确指定本机绝对目录；已有文件不覆盖。不支持远端目录。',
    z
      .object({ courseId: id, videoIds: z.array(id).min(1).max(100), directory: z.string().min(1) })
      .strict(),
    async ({ courseId, videoIds, directory }) => {
      if (!isAbsolute(directory)) throw new Error('请指定本机文件夹的绝对路径');
      if (!(await stat(directory)).isDirectory()) throw new Error('保存位置不是文件夹');
      const course = (await listCourses()).find((course) => course.id === courseId);
      if (!course) throw new Error('未找到指定课程，请先列出课堂视频课程');
      const videos = await listVideos(courseId);
      const selected = [...new Set(videoIds)].map((id) => {
        const video = videos.find((video) => video.id === id);
        if (!video) throw new Error(`录像 ${id} 不在指定课程中`);
        return video;
      });
      const results: Array<{
        videoId: number;
        status: 'saved' | 'unavailable' | 'failed';
        path?: string;
        error?: string;
      }> = [];
      for (const video of selected) {
        try {
          const transcript = await getTranscript(video.id);
          if (!transcript) {
            results.push({ videoId: video.id, status: 'unavailable' });
            continue;
          }
          const title = `${course.name} · ${video.start} · 第 ${video.period || '?'} 节`;
          const name = safeFileName(`${course.name}-${video.start}`);
          const path = join(directory, `${name}-${video.id}.txt`);
          await writeFile(path, formatTranscript(transcript, title), {
            encoding: 'utf8',
            flag: 'wx',
          });
          results.push({ videoId: video.id, status: 'saved', path });
        } catch (error) {
          results.push({
            videoId: video.id,
            status: 'failed',
            error: error instanceof Error ? error.message : '文稿保存失败',
          });
        }
      }
      return { courseId, results };
    },
  ),
};
