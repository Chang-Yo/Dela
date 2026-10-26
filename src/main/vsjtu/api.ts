import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import type { ClassroomVideo, VideoCourse, VideoTranscript } from '../../shared/vsjtu';
import { campusRequest, getCampusSession } from '../campus';
import { parseTranscript } from './transcript';

export { formatSegments, formatTranscript } from './transcript';

export const VIDEO_HOME = 'https://v.sjtu.edu.cn/jy-application-resourcemanage-ui/';
const BASE = 'https://v.sjtu.edu.cn/jy-application-resourcemanage/v1';
const loginError = () => new Error('校园会话已失效，请登录交大视频');
const object = z.record(z.string(), z.unknown());
const id = z.coerce.number().int().positive();
const requests = new Map<string, Promise<unknown>>();

function requestJson(url: string, key = url): Promise<unknown> {
  const pending = requests.get(key);
  if (pending) return pending;
  const task = (async () => {
    try {
      try {
        return await requestOnce(url);
      } catch (error) {
        if (!(error instanceof Error) || error.cause !== 'transient') throw error;
        await delay(250);
        return await requestOnce(url);
      }
    } finally {
      requests.delete(key);
    }
  })();
  requests.set(key, task);
  return task;
}

async function requestOnce(url: string): Promise<unknown> {
  const text = await campusRequest(await getCampusSession(), url, {
    service: '交大视频',
    loginError: loginError().message,
    headers: { Accept: 'application/json', Referer: VIDEO_HOME },
  });
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('交大视频没有返回预期数据，请重新登录');
  }
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
  if (
    result.ok === false ||
    result.dataOk === false ||
    (typeof result.status === 'number' && result.status !== 200)
  )
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
    const response = await requestJson(`${BASE}/${path}?${query}`);
    const data = unwrap(response);
    // 官方接口的成功空分页使用 null；只在第一页且明确零记录时接受。
    if (
      page === 1 &&
      z.object({ ok: z.literal(true), dataOk: z.literal(true) }).safeParse(response).success &&
      z
        .object({ records: z.null(), rowCount: z.literal(0), pageCount: z.literal(0) })
        .safeParse(data).success
    )
      return [];
    const parsed = z
      .object({
        records: z.array(z.unknown()),
        pageCount: z.number().int().nonnegative().optional(),
      })
      .safeParse(data);
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
  let records = await allPages('myself/curriculum', {
    acteId: String(term.id),
    courBeginTime: '',
    courEndTime: '',
  });
  // 部分账号的课表为空，但官网「我的课程」仍有点播；该列表跨学期，须逐条核对。
  if (records.length === 0)
    records = (
      await allPages('group_subject_vod_list/t-1', {
        'page.orders[0].asc': 'false',
        'page.orders[0].field': 'courBeginTime',
      })
    ).filter((raw) => {
      const course = z.object({ acteId: id }).safeParse(raw);
      if (!course.success) throw new Error('交大视频课程学期数据格式已变化');
      return course.data.acteId === term.id;
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
  if (!parsed.success) throw new Error('暂未获取到可播放录像，请稍后重试', { cause: parsed.error });
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

const TRANSCRIPT_TTL_MS = 5 * 60 * 1000;
const TRANSCRIPT_CACHE_BYTES = 1024 * 1024;
let cachedTranscript: VideoTranscript | undefined;
let transcriptTimer: ReturnType<typeof setTimeout> | undefined;
let transcriptSessionWatched = false;
let transcriptGeneration = 0;

function clearTranscriptCache(): void {
  cachedTranscript = undefined;
  clearTimeout(transcriptTimer);
  transcriptTimer = undefined;
}

export async function getTranscript(videoId: number): Promise<VideoTranscript | null> {
  videoId = id.parse(videoId);
  const campus = await getCampusSession();
  if (!transcriptSessionWatched) {
    campus.cookies.on('changed', (_event, cookie) => {
      const domain = cookie.domain?.replace(/^\./, '');
      if (domain && ('v.sjtu.edu.cn' === domain || 'v.sjtu.edu.cn'.endsWith(`.${domain}`))) {
        transcriptGeneration++;
        clearTranscriptCache();
      }
    });
    transcriptSessionWatched = true;
  }
  const generation = transcriptGeneration;
  try {
    // 抓取请求自身会以 401/403/重定向/code:-1 报登录失效；/me 只用于缓存命中的复核。
    if (cachedTranscript?.videoId === videoId) {
      await checkVideoLogin();
      if (generation !== transcriptGeneration) throw loginError();
      return structuredClone(cachedTranscript);
    }
    const url = `${BASE}/course/ai/translate/${videoId}?useOriginal=true`;
    const response = await requestJson(url, `${generation}:${url}`);
    if (generation !== transcriptGeneration) throw loginError();
    const empty = z
      .object({ code: z.null(), status: z.literal(200), ok: z.literal(true), data: z.null() })
      .safeParse(response).success;
    const transcript = parseTranscript(empty ? null : unwrap(response), videoId);
    if (transcript) {
      clearTranscriptCache();
      if (Buffer.byteLength(JSON.stringify(transcript), 'utf8') <= TRANSCRIPT_CACHE_BYTES) {
        cachedTranscript = structuredClone(transcript);
        transcriptTimer = setTimeout(clearTranscriptCache, TRANSCRIPT_TTL_MS);
        transcriptTimer.unref();
      }
    }
    return transcript;
  } catch (error) {
    clearTranscriptCache();
    throw error;
  }
}
