import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import type { ClassroomVideo, VideoCourse, VideoTranscript } from '../../shared/vsjtu';
import {
  CampusAuthError,
  campusRequest,
  flushCampusSession,
  getCampusSession,
  hiddenCampusLogin,
} from '../campus';
import { classroomLoginUrl, getCanvasState } from '../canvas/api';
import { loadCanvasToken } from '../credentials';
import { parseTranscript } from './transcript';

export { formatSegments, formatTranscript } from './transcript';

export const VIDEO_HOME = 'https://v.sjtu.edu.cn/jy-application-resourcemanage-ui/';
const BASE = 'https://v.sjtu.edu.cn/jy-application-resourcemanage/v1';
// 官方页面自用的身份接口；Canvas LTI 取得的会话 Cookie 只作用于该路径，/cloud-rbac 不认。
const ME = 'https://v.sjtu.edu.cn/jy-application-resourcemanage/authority/me';
const loginError = () => new Error('校园会话已失效，请登录交大视频');
const requestOptions = {
  service: '交大视频',
  loginError: loginError().message,
  headers: { Accept: 'application/json', Referer: VIDEO_HOME },
};
// 身份接口未登录时返回 500 与 code -1，而不是 401。
const identityOptions = { ...requestOptions, loginStatus: 500 };
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
  const campus = await getCampusSession();
  const options = url === ME ? identityOptions : requestOptions;
  let text: string;
  try {
    text = await campusRequest(campus, url, options);
  } catch (error) {
    if (!(error instanceof CampusAuthError) || !loadCanvasToken()) throw error;
    await loginWithCanvas();
    text = await campusRequest(campus, url, options);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('交大视频没有返回预期数据，请重新登录');
  }
}

let canvasLogin: Promise<void> | undefined;

/** 已连接 Canvas 时以令牌登录交大视频，免去官方窗口；同时失效的请求共用一次登录。 */
export function loginWithCanvas(): Promise<void> {
  canvasLogin ??= (async () => {
    try {
      // 探测直接请求，不经 requestOnce，避免等待自身这次登录。
      await hiddenCampusLogin(await classroomLoginUrl(), async () =>
        checkIdentity(
          JSON.parse(await campusRequest(await getCampusSession(), ME, identityOptions)),
        ),
      );
      await flushCampusSession();
    } catch (error) {
      throw new Error(
        `通过 Canvas 登录交大视频失败：${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      canvasLogin = undefined;
    }
  })();
  return canvasLogin;
}

function checkIdentity(response: unknown): void {
  const payload = object.safeParse(response);
  if (
    !payload.success ||
    String(payload.data.code) !== '0' ||
    !object.safeParse(payload.data.result).data?.user
  )
    throw loginError();
}

export async function checkVideoLogin(): Promise<void> {
  checkIdentity(await requestJson(ME));
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
  if (loadCanvasToken())
    return getCanvasState()
      .courses.filter((course) => !course.archived)
      .map((course) => ({
        id: course.id,
        code: course.code,
        name: course.name,
        source: 'canvas',
      }));
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
  // 部分账号的课表为空，但官网「课程点播」仍有课程；该列表跨学期，须逐条核对。
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

export async function listVideos(courseId: number, source?: 'canvas'): Promise<ClassroomVideo[]> {
  if (source === 'canvas') {
    const loginUrl = await classroomLoginUrl(id.parse(courseId));
    try {
      courseId = await hiddenCampusLogin(loginUrl, async (navigationUrls) => {
        for (const navigationUrl of navigationUrls) {
          const url = new URL(navigationUrl);
          const [route, query] = url.hash.slice(1).split('?');
          const teachingClass = id.safeParse(new URLSearchParams(query).get('teclId'));
          if (
            url.origin === 'https://v.sjtu.edu.cn' &&
            url.pathname === '/jy-application-resourcemanage-ui/' &&
            route === '/play-center' &&
            teachingClass.success
          )
            return teachingClass.data;
        }
        throw new Error('尚未取得课堂视频教学班');
      });
    } catch (error) {
      throw new Error('未能取得该课程的视频教学班，请从 Canvas 的课堂视频入口确认是否可用', {
        cause: error,
      });
    }
  }
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
    // 会话在请求期间更新（重新登录或 Canvas 自动登录）时按新会话重取，不返回旧会话的结果。
    if (cachedTranscript?.videoId === videoId) {
      await checkVideoLogin();
      if (generation !== transcriptGeneration) return await getTranscript(videoId);
      return structuredClone(cachedTranscript);
    }
    const url = `${BASE}/course/ai/translate/${videoId}?useOriginal=true`;
    const response = await requestJson(url, `${generation}:${url}`);
    if (generation !== transcriptGeneration) return await getTranscript(videoId);
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
