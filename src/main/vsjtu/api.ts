// 课堂视频（v.sjtu.edu.cn）主进程业务：课程/场次同步缓存、播放直链、复习数据
// （转写/知识点/PPT 切片）与项目来源引用行。鉴权复用课表的校园 Session
// （*.sjtu.edu.cn Cookie），未登录表现为空响应而非 401——所有入口先经 authority/me
// 探活，不把空列表当「无录课」。接口字段名依据 2026-10-06 实测报告，部分列表行的
// 包裹键（records/rows/list）未逐一复测，解析层按候选键宽容读取。
import { net, shell, type WebContents } from 'electron';
import { z } from 'zod';
import { getDatabase } from '../database';
import { flushCampusSession, getCampusSession, openCampusLoginWindow } from '../timetable/session';
import type { DocumentContent } from '../../shared/api';
import type {
  VsjtuChapterNode,
  VsjtuCourse,
  VsjtuList,
  VsjtuPlayInfo,
  VsjtuPlayView,
  VsjtuPptPage,
  VsjtuResult,
  VsjtuSourceRef,
  VsjtuState,
  VsjtuTimeRange,
  VsjtuTranscriptLine,
  VsjtuVideo,
} from '../../shared/api';

const PORTAL_ORIGIN = 'https://v.sjtu.edu.cn';
const API_BASE = `${PORTAL_ORIGIN}/jy-application-resourcemanage/v1`;
const AUTHORITY_URL = `${PORTAL_ORIGIN}/cloud-rbac/authority/me`;
/** 单页上限：课程/场次都不超过两位数，一页足以覆盖；分页循环仍按满页续拉。 */
const PAGE_SIZE = 100;
const MAX_PAGES = 10;
const REQUEST_TIMEOUT_MS = 15000;

export const AUTH_EXPIRED_MESSAGE = '校园会话已失效，请重新登录';

/** 校园 Cookie 直连 GET：手动跟随重定向（3xx 视为登录失效），JSON envelope 原样返回。 */
function campusGet(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    void (async () => {
      let campus;
      try {
        campus = await getCampusSession();
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      const request = net.request({
        url,
        method: 'GET',
        session: campus,
        useSessionCookies: true,
        redirect: 'manual',
      });
      const fail = (error: Error) => {
        clearTimeout(timer);
        reject(error);
        request.abort();
      };
      const timer = setTimeout(
        () => fail(new Error('课堂视频接口请求超时，请稍后重试')),
        REQUEST_TIMEOUT_MS,
      );
      request.on('error', fail);
      request.on('redirect', () => fail(new Error(AUTH_EXPIRED_MESSAGE)));
      request.on('response', (response) => {
        const status = response.statusCode;
        if (status >= 300 && status < 400) {
          fail(new Error(AUTH_EXPIRED_MESSAGE));
          return;
        }
        if (status >= 400) {
          fail(new Error(`课堂视频接口返回 ${status}`));
          return;
        }
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('error', fail);
        response.on('aborted', () => fail(new Error('课堂视频请求中断，请稍后重试')));
        response.on('end', () => {
          clearTimeout(timer);
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          } catch {
            // 未登录时平台返回空响应体而不是 401，按会话失效处理。
            reject(new Error(AUTH_EXPIRED_MESSAGE));
          }
        });
      });
      request.setHeader('Accept', 'application/json');
      request.end();
    })();
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** envelope { code, data, message, ok, status }：ok===true / code 为 null 或 '0' 视为成功。 */
export function unwrapEnvelope(payload: unknown): unknown {
  if (!isRecord(payload)) throw new Error('课堂视频接口没有返回预期的数据');
  const code = payload['code'];
  const ok = payload['ok'];
  if (ok === true || code === null || code === undefined || code === '0' || code === 0) {
    const data = payload['data'];
    return data === undefined || data === null ? payload : data;
  }
  const message = payload['message'];
  if (typeof message === 'string' && message.trim())
    throw new Error(`课堂视频接口错误：${message}`);
  if (code === '401' || code === 401) throw new Error(AUTH_EXPIRED_MESSAGE);
  throw new Error('课堂视频接口没有返回预期的数据');
}

/** 分页列表行：未知结构报错，不能当成无录像而清空缓存。 */
export function rowsOf(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (isRecord(value))
    for (const key of ['records', 'rows', 'list', 'data']) {
      const inner = value[key];
      if (Array.isArray(inner)) return inner;
    }
  throw new Error('课堂视频接口没有返回预期的列表数据');
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function positiveInt(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function nonNegativeNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/** authority/me：code === '0' 即登录有效；顺带取姓名（字段名未定稿，宽容读取）。 */
export function parseAuthorityUser(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  if (payload['code'] !== '0' && payload['code'] !== 0) return null;
  const result = payload['result'];
  if (!isRecord(result)) return null;
  const user = result['user'];
  if (!isRecord(user)) return null;
  return text(user['name']) ?? text(user['userName']) ?? text(user['realName']);
}

/** curriculum 行 → 教学班（teclId/subjCode/subjName，courBeginTime 供排序参考）。 */
export function parseCurriculumRows(payload: unknown): VsjtuCourse[] {
  const rows = rowsOf(unwrapEnvelope(payload));
  const courses = new Map<number, VsjtuCourse>();
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const teclId = positiveInt(row['teclId']);
    const subjName = text(row['subjName']) ?? text(row['subjname']);
    if (teclId === null || !subjName) continue;
    courses.set(teclId, {
      teclId,
      subjCode: text(row['subjCode']) ?? text(row['subjcode']),
      subjName,
      videoCount: 0,
      latestBeginTime: null,
    });
  }
  return [...courses.values()];
}

/** vod 场次行 → VsjtuVideo；行缺 id 或 teclId 时丢弃。 */
export function parseVodRows(payload: unknown): VsjtuVideo[] {
  const rows = rowsOf(unwrapEnvelope(payload));
  const videos: VsjtuVideo[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const courseId = positiveInt(row['id'] ?? row['courseId']);
    const teclId = positiveInt(row['teclId']);
    if (courseId === null || teclId === null) continue;
    const teacher =
      text(row['teacName']) ??
      text(row['teacherName']) ??
      text(row['teacher']) ??
      text(row['userName']);
    videos.push({
      courseId,
      teclId,
      beginTime: text(row['courBeginTime']) ?? text(row['beginTime']) ?? '',
      endTime: text(row['courEndTime']) ?? text(row['endTime']),
      letiNumber: positiveInt(row['letiNumber']),
      classroom: text(row['clroName']) ?? text(row['classroomName']),
      teacher,
      vodTime: nonNegativeNumber(row['vodTime']),
      thumbUrl: text(row['shotImgUrl']) ?? text(row['thumbUrl']),
      transferReady:
        row['courTransferFlag'] === 1 ||
        row['courTransferFlag'] === '1' ||
        row['courTransferFlag'] === true,
      pptReady: row['coursePptSliceStatus'] === 5 || row['coursePptSliceStatus'] === '5',
    });
  }
  return videos;
}

/** course_vod_urls_new → 双路 MP4 直链（url/viewNum/vodTime）。 */
export function parsePlayViews(payload: unknown): VsjtuPlayView[] {
  const data = unwrapEnvelope(payload);
  const list = isRecord(data) ? data['courseVodViewList'] : undefined;
  if (!Array.isArray(list)) return [];
  const views: VsjtuPlayView[] = [];
  for (const row of list) {
    if (!isRecord(row)) continue;
    const url = text(row['url']);
    if (!url) continue;
    views.push({
      viewNum: positiveInt(row['viewNum']) ?? views.length + 1,
      url,
      vodTime: nonNegativeNumber(row['vodTime']),
    });
  }
  return views;
}

/** course_vod_subtitle_with_keyword → 逐句转写（bg/ed 毫秒、res 句文本）。 */
export function parseTranscript(payload: unknown): VsjtuTranscriptLine[] {
  const data = unwrapEnvelope(payload);
  const list = isRecord(data) ? data['courseTransferEsDtoList'] : undefined;
  if (!Array.isArray(list)) return [];
  const lines: VsjtuTranscriptLine[] = [];
  for (const row of list) {
    if (!isRecord(row)) continue;
    const beginMs = nonNegativeNumber(row['bg']);
    const endMs = nonNegativeNumber(row['ed']);
    const lineText = text(row['res']);
    if (beginMs === null || endMs === null || !lineText) continue;
    lines.push({ beginMs, endMs, text: lineText });
  }
  return lines;
}

function parseRange(value: unknown): VsjtuTimeRange | null {
  if (Array.isArray(value) && value.length >= 2) {
    const start = nonNegativeNumber(value[0]);
    const end = nonNegativeNumber(value[1]);
    if (start !== null && end !== null) return { start, end };
    return null;
  }
  if (!isRecord(value)) return null;
  const start = nonNegativeNumber(value['start'] ?? value['startTime'] ?? value['beginTime']);
  const end = nonNegativeNumber(value['end'] ?? value['endTime']);
  if (start === null || end === null) return null;
  return { start, end };
}

function parseChapterNode(value: unknown): VsjtuChapterNode | null {
  if (!isRecord(value)) return null;
  const label = text(value['label'] ?? value['name']);
  if (!label) return null;
  const ranges: VsjtuTimeRange[] = [];
  const rawRanges = value['timeRanges'];
  if (Array.isArray(rawRanges))
    for (const range of rawRanges) {
      const parsed = parseRange(range);
      if (parsed) ranges.push(parsed);
    }
  const children: VsjtuChapterNode[] = [];
  const rawChildren = value['children'] ?? value['child'] ?? value['nodes'];
  if (Array.isArray(rawChildren))
    for (const child of rawChildren) {
      const parsed = parseChapterNode(child);
      if (parsed) children.push(parsed);
    }
  return { label, ranges, children };
}

/** textSummary/{id} → mindmap 知识点树；mindmap 为 JSON 字符串，失败返回空树。 */
export function parseChapters(payload: unknown): VsjtuChapterNode[] {
  const data = unwrapEnvelope(payload);
  const mindmap = isRecord(data) ? data['mindmap'] : undefined;
  if (typeof mindmap !== 'string' || !mindmap.trim()) return [];
  let tree: unknown;
  try {
    tree = JSON.parse(mindmap);
  } catch {
    return [];
  }
  const roots = Array.isArray(tree) ? tree : [tree];
  const nodes: VsjtuChapterNode[] = [];
  for (const root of roots) {
    const parsed = parseChapterNode(root);
    if (parsed) nodes.push(parsed);
  }
  return nodes;
}

/** course/ai/ppt → 逐页快照（imageUrl/ocrText/imageSeekTime 秒）。 */
export function parsePpt(payload: unknown): VsjtuPptPage[] {
  const data = unwrapEnvelope(payload);
  const list = isRecord(data) ? data['docList'] : undefined;
  if (!Array.isArray(list)) return [];
  const pages: VsjtuPptPage[] = [];
  for (const row of list) {
    if (!isRecord(row)) continue;
    const imageUrl = text(row['imageUrl']);
    if (!imageUrl) continue;
    pages.push({
      index: pages.length + 1,
      imageUrl,
      ocrText: text(row['ocrText']),
      seekTime: nonNegativeNumber(row['imageSeekTime']),
    });
  }
  return pages;
}

function queryUrl(base: string, params: Record<string, string>): string {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

/** 分页拉取（pageIndex 从 1 起，满页续拉，上限 MAX_PAGES）。 */
async function fetchPaged(build: (pageIndex: number) => string): Promise<unknown[]> {
  const rows: unknown[] = [];
  for (let pageIndex = 1; pageIndex <= MAX_PAGES; pageIndex += 1) {
    const page = rowsOf(unwrapEnvelope(await campusGet(build(pageIndex))));
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

/** 已成功同步过的学期 acteId（curriculum 的可选参数；首次同步留空交由服务端默认）。 */
function storedActeId(): string | null {
  const row = getDatabase()
    .prepare('SELECT acte_id AS acteId FROM vsjtu_sync WHERE id = 1')
    .get() as { acteId: string | null } | undefined;
  return row?.acteId ?? null;
}

async function probeAuthority(): Promise<string | null> {
  const payload = await campusGet(AUTHORITY_URL);
  const username = parseAuthorityUser(payload);
  if (username === null) throw new Error(AUTH_EXPIRED_MESSAGE);
  return username;
}

/** 从教学班详情提取 acteId（学期枚举接口参数未探明，best-effort，失败忽略）。 */
function parseActeId(payload: unknown): string | null {
  const data = unwrapEnvelope(payload);
  const candidates: unknown[] = [data];
  if (isRecord(data))
    for (const key of ['teachingClass', 'termYear', 'acte']) candidates.push(data[key]);
  for (const candidate of candidates)
    if (isRecord(candidate)) {
      const acteId = positiveInt(candidate['acteId']);
      if (acteId !== null) return String(acteId);
    }
  return null;
}

type SyncRow = {
  course_id: number;
  tecl_id: number;
  begin_time: string;
  end_time: string | null;
  leti_number: number | null;
  classroom: string | null;
  teacher: string | null;
  vod_time: number | null;
  thumb_url: string | null;
  transfer_ready: number;
  ppt_ready: number;
  updated_at: string;
};

function mapVideoRow(row: SyncRow): VsjtuVideo {
  return {
    courseId: row.course_id,
    teclId: row.tecl_id,
    beginTime: row.begin_time,
    endTime: row.end_time,
    letiNumber: row.leti_number,
    classroom: row.classroom,
    teacher: row.teacher,
    vodTime: row.vod_time,
    thumbUrl: row.thumb_url,
    transferReady: row.transfer_ready === 1,
    pptReady: row.ppt_ready === 1,
  };
}

function rememberSyncError(message: string): void {
  getDatabase()
    .prepare(
      `INSERT INTO vsjtu_sync (id, last_synced_at, error) VALUES (1, COALESCE((SELECT last_synced_at FROM vsjtu_sync WHERE id = 1), ''), ?)
       ON CONFLICT(id) DO UPDATE SET error = excluded.error`,
    )
    .run(message);
}

export async function syncVsjtu(): Promise<VsjtuResult> {
  try {
    await probeAuthority();
    const acteId = storedActeId();
    const courseRows = await fetchPaged((pageIndex) =>
      queryUrl(`${API_BASE}/myself/curriculum`, {
        ...(acteId ? { acteId } : {}),
        'page.pageIndex': String(pageIndex),
        'page.pageSize': String(PAGE_SIZE),
      }),
    );
    const courses = parseCurriculumRows({ records: courseRows });
    if (courses.length === 0) throw new Error('没有读取到选课列表，请重新登录后再试');

    const teclIds = courses.map((course) => course.teclId);
    // teclIds 逗号拼接一次查询；过长时按 10 个教学班分批。
    const batches: string[][] = [];
    for (let index = 0; index < teclIds.length; index += 10)
      batches.push(teclIds.slice(index, index + 10).map(String));
    const videos: VsjtuVideo[] = [];
    for (const batch of batches)
      videos.push(
        ...parseVodRows({
          records: await fetchPaged((pageIndex) =>
            queryUrl(`${API_BASE}/subject_vod_list_new`, {
              teclIds: batch.join(','),
              'page.pageIndex': String(pageIndex),
              'page.pageSize': String(PAGE_SIZE),
            }),
          ),
        }),
      );

    // 学期 acteId 只在缺失时尝试补齐（一次教学班详情请求），供下次同步显式传参。
    let discoveredActeId: string | null = null;
    if (!acteId && courses[0]) {
      try {
        discoveredActeId = parseActeId(
          await campusGet(`${API_BASE}/teachingClass/${courses[0].teclId}/t-1`),
        );
      } catch {
        discoveredActeId = null;
      }
    }

    const db = getDatabase();
    const syncedAt = new Date().toISOString();
    db.transaction(() => {
      db.prepare('DELETE FROM vsjtu_courses').run();
      const insertCourse = db.prepare(
        'INSERT INTO vsjtu_courses (tecl_id, subj_code, subj_name) VALUES (?, ?, ?)',
      );
      for (const course of courses)
        insertCourse.run(course.teclId, course.subjCode, course.subjName);
      db.prepare('DELETE FROM vsjtu_videos').run();
      const insertVideo = db.prepare(
        `INSERT INTO vsjtu_videos (course_id, tecl_id, begin_time, end_time, leti_number, classroom,
           teacher, vod_time, thumb_url, transfer_ready, ppt_ready, updated_at)
         VALUES (@course_id, @tecl_id, @begin_time, @end_time, @leti_number, @classroom, @teacher,
           @vod_time, @thumb_url, @transfer_ready, @ppt_ready, @updated_at)`,
      );
      for (const video of videos)
        insertVideo.run({
          course_id: video.courseId,
          tecl_id: video.teclId,
          begin_time: video.beginTime,
          end_time: video.endTime,
          leti_number: video.letiNumber,
          classroom: video.classroom,
          teacher: video.teacher,
          vod_time: video.vodTime,
          thumb_url: video.thumbUrl,
          transfer_ready: video.transferReady ? 1 : 0,
          ppt_ready: video.pptReady ? 1 : 0,
          updated_at: syncedAt,
        } satisfies SyncRow);
      db.prepare(
        `INSERT INTO vsjtu_sync (id, last_synced_at, acte_id, error) VALUES (1, ?, ?, NULL)
         ON CONFLICT(id) DO UPDATE SET
           last_synced_at = excluded.last_synced_at,
           acte_id = COALESCE(excluded.acte_id, vsjtu_sync.acte_id),
           error = NULL`,
      ).run(syncedAt, discoveredActeId);
    })();
    return { ok: true };
  } catch (error) {
    // 会话失效不清缓存（对齐 Canvas 断连行为），保留上次成功数据与时间。
    const message = error instanceof Error ? error.message : String(error);
    rememberSyncError(message);
    return { ok: false, error: message };
  }
}

let lastUsername: string | null = null;

export async function getVsjtuState(): Promise<VsjtuState> {
  const row = getDatabase()
    .prepare('SELECT last_synced_at, error FROM vsjtu_sync WHERE id = 1')
    .get() as { last_synced_at: string | null; error: string | null } | undefined;
  let connected = false;
  try {
    lastUsername = await probeAuthority();
    connected = true;
  } catch {
    connected = false;
  }
  return {
    connected,
    username: connected ? lastUsername : null,
    lastSyncedAt: row?.last_synced_at || null,
    error: row?.error || null,
  };
}

export function openVsjtuLoginWindow(sender: WebContents): Promise<VsjtuResult> {
  return openCampusLoginWindow({
    sender,
    title: '登录交大视频',
    // 通过平台入口完成 jAccount SSO；已有校园会话时探活通过即可收场。
    url: PORTAL_ORIGIN,
    reached: (url) => url.startsWith('https://v.sjtu.edu.cn/'),
    // 入口页即目标域：未登录时保持窗口，覆盖 SSO 回跳、SPA 导航及异步登录。
    retryProbe: true,
    probe: async () => {
      await probeAuthority();
      await flushCampusSession();
    },
  });
}

/** 只列有录播的课程（JOIN 计数过滤，裁决：无录课的课程不出现在课程栏）。 */
export function listVsjtu(): VsjtuList {
  const db = getDatabase();
  const courses = (
    db
      .prepare(
        `SELECT c.tecl_id AS teclId, c.subj_code AS subjCode, c.subj_name AS subjName,
                COUNT(v.course_id) AS videoCount, MAX(v.begin_time) AS latestBeginTime
         FROM vsjtu_courses c JOIN vsjtu_videos v ON v.tecl_id = c.tecl_id
         GROUP BY c.tecl_id HAVING videoCount > 0 ORDER BY latestBeginTime DESC`,
      )
      .all() as Array<{
      teclId: number;
      subjCode: string | null;
      subjName: string;
      videoCount: number;
      latestBeginTime: string | null;
    }>
  ).map((row) => ({
    teclId: row.teclId,
    subjCode: row.subjCode,
    subjName: row.subjName,
    videoCount: row.videoCount,
    latestBeginTime: row.latestBeginTime,
  }));
  const videos = (
    db.prepare('SELECT * FROM vsjtu_videos ORDER BY begin_time DESC').all() as SyncRow[]
  ).map(mapVideoRow);
  return { courses, videos };
}

export async function getVsjtuPlayInfo(courseIdInput: unknown): Promise<VsjtuPlayInfo> {
  const courseId = z.number().int().positive().parse(courseIdInput);
  const views = parsePlayViews(
    await campusGet(queryUrl(`${API_BASE}/course_vod_urls_new`, { courseId: String(courseId) })),
  );
  if (views.length === 0) throw new Error('没有取得可播放地址，课程可能还未录制或会话已失效');
  return { courseId, views };
}

export async function getVsjtuTranscript(
  courseIdInput: unknown,
): Promise<readonly VsjtuTranscriptLine[]> {
  const courseId = z.number().int().positive().parse(courseIdInput);
  return parseTranscript(
    await campusGet(
      queryUrl(`${API_BASE}/course_vod_subtitle_with_keyword`, { courseId: String(courseId) }),
    ),
  );
}

export async function getVsjtuChapters(
  courseIdInput: unknown,
): Promise<readonly VsjtuChapterNode[]> {
  const courseId = z.number().int().positive().parse(courseIdInput);
  return parseChapters(await campusGet(`${API_BASE}/course/ai/textSummary/${courseId}`));
}

export async function getVsjtuPpt(courseIdInput: unknown): Promise<readonly VsjtuPptPage[]> {
  const courseId = z.number().int().positive().parse(courseIdInput);
  return parsePpt(
    await campusGet(queryUrl(`${API_BASE}/course/ai/ppt`, { courseId: String(courseId) })),
  );
}

type RefRow = {
  course_id: number;
  title: string;
  course_name: string | null;
  begin_time: string | null;
  leti_number: number | null;
  vod_time: number | null;
  added_at: string;
};

function mapRefRow(row: RefRow): VsjtuSourceRef {
  return {
    videoId: row.course_id,
    title: row.title,
    courseName: row.course_name,
    beginTime: row.begin_time,
    letiNumber: row.leti_number,
    vodTime: row.vod_time,
    addedAt: row.added_at,
  };
}

/** 引用行标题：课程名 + 日期 + 节次；缓存缺失时回退通用标题。 */
export function vsjtuVideoTitle(videoId: number): string | null {
  const db = getDatabase();
  const row = db
    .prepare(
      `SELECT v.begin_time AS beginTime, v.leti_number AS letiNumber, c.subj_name AS subjName
       FROM vsjtu_videos v LEFT JOIN vsjtu_courses c ON c.tecl_id = v.tecl_id
       WHERE v.course_id = ?`,
    )
    .get(videoId) as
    { beginTime: string; letiNumber: number | null; subjName: string | null } | undefined;
  if (!row) return null;
  const date = row.beginTime.slice(0, 10);
  const leti = row.letiNumber !== null ? `第${row.letiNumber}节` : null;
  return [row.subjName ?? '课堂视频', date, leti].filter(Boolean).join(' ');
}

/** 添加到项目前写入/更新引用行（只存元数据快照；直链有有效期、绝不入库）。 */
export function addVsjtuSourceRef(videoIdInput: unknown): VsjtuSourceRef {
  const videoId = z.number().int().positive().parse(videoIdInput);
  const db = getDatabase();
  const video = db.prepare('SELECT * FROM vsjtu_videos WHERE course_id = ?').get(videoId) as
    SyncRow | undefined;
  const title = vsjtuVideoTitle(videoId);
  if (!video || !title) throw new Error('该视频不在本地缓存中，请回到课堂视频页刷新后再添加');
  const courseName =
    (
      db
        .prepare('SELECT subj_name AS name FROM vsjtu_courses WHERE tecl_id = ?')
        .get(video.tecl_id) as { name: string } | undefined
    )?.name ?? null;
  const ref: VsjtuSourceRef = {
    videoId,
    title,
    courseName,
    beginTime: video.begin_time || null,
    letiNumber: video.leti_number,
    vodTime: video.vod_time,
    addedAt: new Date().toISOString(),
  };
  db.prepare(
    `INSERT INTO vsjtu_video_refs (course_id, title, course_name, begin_time, leti_number, vod_time, added_at)
     VALUES (@videoId, @title, @courseName, @beginTime, @letiNumber, @vodTime, @addedAt)
     ON CONFLICT(course_id) DO UPDATE SET
       title = excluded.title, course_name = excluded.course_name, begin_time = excluded.begin_time,
       leti_number = excluded.leti_number, vod_time = excluded.vod_time`,
  ).run(ref);
  return ref;
}

export function getVsjtuSourceRef(videoIdInput: unknown): VsjtuSourceRef | null {
  const videoId = z.number().int().positive().parse(videoIdInput);
  const row = getDatabase()
    .prepare('SELECT * FROM vsjtu_video_refs WHERE course_id = ?')
    .get(videoId) as RefRow | undefined;
  return row ? mapRefRow(row) : null;
}

/** 项目工作区读取课堂视频来源：引用元数据合成 HTML（播放去课堂视频页）。 */
export async function readVsjtuVideoSource(videoIdInput: unknown): Promise<DocumentContent> {
  const ref = getVsjtuSourceRef(videoIdInput) ?? addVsjtuSourceRef(videoIdInput);
  const rows: Array<[string, string | null]> = [
    ['课程', ref.courseName],
    ['时间', ref.beginTime],
    ['节次', ref.letiNumber !== null ? `第 ${ref.letiNumber} 节` : null],
    ['时长', ref.vodTime !== null ? `${Math.round(ref.vodTime / 60)} 分钟` : null],
  ];
  const meta = rows
    .filter(([, value]) => value !== null)
    .map(([label, value]) => `<li><b>${label}</b>：${value}</li>`)
    .join('');
  return {
    title: ref.title,
    format: 'html',
    text: `<p>课堂录像引用（不在预览中播放）。</p><ul>${meta}</ul><p>请在侧栏「课堂视频」中打开播放。</p>`,
    url: PORTAL_ORIGIN,
  };
}

/** 浏览器打开原文（仅 http(s)，嵌入凭据的目标拒绝）。 */
export async function openVsjtuLink(urlInput: unknown): Promise<void> {
  const url = z.string().url().parse(urlInput);
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')
    throw new Error('仅支持 http(s) 链接');
  if (parsed.username || parsed.password) throw new Error('不接受嵌入凭据的链接');
  await shell.openExternal(parsed.href);
}
