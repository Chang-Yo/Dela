import { net } from 'electron';
import { z } from 'zod';
import type { ClassroomVideo, VideoCourse } from '../../shared/vsjtu';
import { getCampusSession } from '../timetable/session';

export const VIDEO_HOME = 'https://v.sjtu.edu.cn/jy-application-resourcemanage-ui/';
const BASE = 'https://v.sjtu.edu.cn/jy-application-resourcemanage/v1';
const loginError = () => new Error('校园会话已失效，请登录交大视频');
const object = z.record(z.string(), z.unknown());
const id = z.coerce.number().int().positive();

async function requestJson(url: string): Promise<unknown> {
  const campus = await getCampusSession();
  return new Promise((resolve, reject) => {
    const request = net.request({
      url,
      session: campus,
      useSessionCookies: true,
      redirect: 'manual',
    });
    const fail = (error: Error) => {
      clearTimeout(timer);
      reject(error);
      request.abort();
    };
    const timer = setTimeout(() => fail(new Error('交大视频请求超时，请重试')), 15000);
    request.on('error', () => fail(new Error('无法连接交大视频，请检查网络')));
    request.on('redirect', () => fail(loginError()));
    request.on('response', (response) => {
      if (
        response.statusCode === 401 ||
        response.statusCode === 403 ||
        (response.statusCode >= 300 && response.statusCode < 400)
      ) {
        fail(loginError());
        return;
      }
      if (response.statusCode !== 200) {
        fail(new Error(`交大视频接口返回 ${response.statusCode}`));
        return;
      }
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('error', () => fail(new Error('交大视频响应中断')));
      response.on('aborted', () => fail(new Error('交大视频响应中断')));
      response.on('end', () => {
        clearTimeout(timer);
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch {
          reject(new Error('交大视频没有返回预期数据，请重新登录'));
        }
      });
    });
    request.setHeader('Accept', 'application/json');
    request.setHeader('Referer', VIDEO_HOME);
    request.end();
  });
}

export async function checkVideoLogin(): Promise<void> {
  const payload = object.safeParse(
    await requestJson('https://v.sjtu.edu.cn/cloud-rbac/authority/me'),
  );
  if (
    !payload.success ||
    String(payload.data.code) !== '0' ||
    !object.safeParse(payload.data.result).data?.user
  )
    throw loginError();
}

function unwrap(payload: unknown): unknown {
  const parsed = object.safeParse(payload);
  if (!parsed.success) throw new Error('交大视频响应数据格式已变化');
  const result = parsed.data;
  if (result.status === 401 || result.status === 403 || result.code === '-1') throw loginError();
  if (result.ok === false || (typeof result.status === 'number' && result.status !== 200))
    throw new Error('交大视频接口请求失败');
  return result.result ?? result.data;
}

async function allPages(path: string, params: Record<string, string>): Promise<unknown[]> {
  const records: unknown[] = [];
  for (let page = 1; ; page++) {
    const query = new URLSearchParams({
      ...params,
      'page.pageIndex': String(page),
      'page.pageSize': '1000',
    });
    const parsed = z
      .object({
        records: z.array(z.unknown()),
        pageCount: z.number().int().nonnegative().optional(),
      })
      .safeParse(unwrap(await requestJson(`${BASE}/${path}?${query}`)));
    if (!parsed.success) throw new Error('交大视频列表数据格式已变化');
    records.push(...parsed.data.records);
    if (
      parsed.data.pageCount !== undefined
        ? page >= parsed.data.pageCount
        : parsed.data.records.length < 1000
    )
      return records;
  }
}

export async function listCourses(): Promise<VideoCourse[]> {
  await checkVideoLogin();
  const termResponse = await requestJson(`${BASE}/list/termYear`);
  const terms = z
    .array(z.object({ id, currentTerm: z.boolean().optional() }))
    .safeParse(Array.isArray(termResponse) ? termResponse : unwrap(termResponse));
  if (!terms.success) throw new Error('交大视频学期数据格式已变化');
  const term = terms.data.find((value) => value.currentTerm) ?? terms.data.at(-1);
  if (!term) return [];
  const records = await allPages('myself/curriculum', {
    acteId: String(term.id),
    courBeginTime: '',
    courEndTime: '',
  });
  const courses = new Map<number, VideoCourse>();
  for (const raw of records) {
    const course = z
      .object({ teclId: id.nullable(), subjCode: z.string().nullish(), subjName: z.string() })
      .safeParse(raw);
    if (!course.success) throw new Error('交大视频课程数据格式已变化');
    if (course.data.teclId)
      courses.set(course.data.teclId, {
        id: course.data.teclId,
        code: course.data.subjCode ?? '',
        name: course.data.subjName,
      });
  }
  return [...courses.values()];
}

export async function listVideos(courseId: number): Promise<ClassroomVideo[]> {
  await checkVideoLogin();
  const records = await allPages('subject_vod_list_new', {
    teclIds: String(id.parse(courseId)),
    'page.orders[0].asc': 'false',
    'page.orders[0].field': 'courBeginTime',
  });
  return records.map((raw) => {
    const video = z
      .object({
        id,
        courBeginTime: z.string(),
        courEndTime: z.string(),
        clroName: z.string().nullish(),
        letiNumber: z.union([z.string(), z.number()]).nullish(),
      })
      .safeParse(raw);
    if (!video.success) throw new Error('交大视频录像数据格式已变化');
    return {
      id: video.data.id,
      start: video.data.courBeginTime,
      end: video.data.courEndTime,
      room: video.data.clroName ?? '',
      period: String(video.data.letiNumber ?? ''),
    };
  });
}

export function parseStreams(
  payload: unknown,
): Array<{ url: string; view: number; duration: number }> {
  const parsed = z
    .object({
      courseVodViewList: z.array(
        z.object({
          url: z.string(),
          viewNum: id,
          vodTime: z.coerce.number().nonnegative().nullish(),
        }),
      ),
    })
    .safeParse(payload);
  if (!parsed.success) throw new Error('交大视频画面数据格式已变化');
  return parsed.data.courseVodViewList.map((stream) => {
    const url = new URL(stream.url);
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'live.sjtu.edu.cn' ||
      (url.port && url.port !== '443') ||
      url.username ||
      url.password ||
      !url.pathname.toLowerCase().endsWith('.mp4')
    )
      throw new Error('交大视频返回了不支持的媒体地址');
    return { url: url.href, view: stream.viewNum, duration: stream.vodTime ?? 0 };
  });
}

export async function getStreams(videoId: number) {
  await checkVideoLogin();
  return parseStreams(
    unwrap(await requestJson(`${BASE}/course_vod_urls_new?courseId=${id.parse(videoId)}`)),
  );
}
