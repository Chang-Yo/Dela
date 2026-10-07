// 课堂视频主进程逻辑：envelope/行解析的宽容读取、同步落库与缓存保留、引用行写入。
// 接口包裹键（records/rows/list）与部分字段名来自 2026-10-06 实测报告，真实会话回归待实测。
import Database from 'better-sqlite3';
import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const netState = vi.hoisted(() => ({ respond: (_url: string): unknown => ({}) }));

vi.mock('electron', () => ({
  net: {
    request: (options: { url: string }) => {
      const payload = netState.respond(options.url);
      const request = new EventEmitter() as EventEmitter & {
        setHeader: () => void;
        end: () => void;
        abort: () => void;
      };
      request.setHeader = () => {};
      request.abort = () => {};
      request.end = () => {
        const response = new EventEmitter() as EventEmitter & { statusCode: number };
        queueMicrotask(() => {
          response.statusCode = 200;
          request.emit('response', response);
          response.emit(
            'data',
            Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload ?? {})),
          );
          response.emit('end');
        });
      };
      return request;
    },
  },
  shell: { openExternal: vi.fn() },
}));
vi.mock('../../database', () => ({ getDatabase: vi.fn() }));
vi.mock('../../timetable/session', () => ({
  getCampusSession: vi.fn(async () => ({})),
  flushCampusSession: vi.fn(async () => {}),
  openCampusLoginWindow: vi.fn(),
}));

import { getDatabase } from '../../database';
import {
  addVsjtuSourceRef,
  getVsjtuSourceRef,
  listVsjtu,
  parseAuthorityUser,
  parseChapters,
  parseCurriculumRows,
  parsePpt,
  parsePlayViews,
  parseTranscript,
  parseVodRows,
  syncVsjtu,
  unwrapEnvelope,
  rowsOf,
} from '../api';

function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE vsjtu_sync (
      id INTEGER PRIMARY KEY CHECK(id = 1), last_synced_at TEXT, acte_id TEXT, error TEXT
    );
    CREATE TABLE vsjtu_courses (tecl_id INTEGER PRIMARY KEY, subj_code TEXT, subj_name TEXT NOT NULL);
    CREATE TABLE vsjtu_videos (
      course_id INTEGER PRIMARY KEY, tecl_id INTEGER NOT NULL, begin_time TEXT NOT NULL,
      end_time TEXT, leti_number INTEGER, classroom TEXT, teacher TEXT, vod_time REAL,
      thumb_url TEXT, transfer_ready INTEGER NOT NULL DEFAULT 0,
      ppt_ready INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
    );
    CREATE TABLE vsjtu_video_refs (
      course_id INTEGER PRIMARY KEY, title TEXT NOT NULL, course_name TEXT, begin_time TEXT,
      leti_number INTEGER, vod_time REAL, added_at TEXT NOT NULL
    );
  `);
  return db;
}

let db: Database.Database;
beforeEach(() => {
  db = createDb();
  vi.mocked(getDatabase).mockReturnValue(db as never);
});

describe('envelope 与列表行解析', () => {
  it('ok/code 成功形态都解包 data，失败抛 message', () => {
    expect(unwrapEnvelope({ ok: true, data: { a: 1 }, code: null })).toEqual({ a: 1 });
    expect(unwrapEnvelope({ code: '0', data: [1] })).toEqual([1]);
    expect(unwrapEnvelope({ records: [1, 2] })).toEqual({ records: [1, 2] });
    expect(() => unwrapEnvelope({ code: 500, message: '服务错误' })).toThrow('服务错误');
    expect(() => unwrapEnvelope('x')).toThrow();
  });

  it('rowsOf 按 records/rows/list 包裹键读取，嵌套 data 先经 unwrapEnvelope', () => {
    expect(rowsOf({ records: [1] })).toEqual([1]);
    expect(rowsOf(unwrapEnvelope({ ok: true, data: { rows: [2] } }))).toEqual([2]);
    expect(rowsOf({ list: [3] })).toEqual([3]);
    expect(() => rowsOf({ x: 1 })).toThrow('列表');
  });

  it('authority/me 取用户名，code 非 0 视为未登录', () => {
    expect(parseAuthorityUser({ code: '0', result: { user: { name: '胡同学' } } })).toBe('胡同学');
    expect(parseAuthorityUser({ code: '401' })).toBeNull();
    expect(parseAuthorityUser({})).toBeNull();
  });

  it('curriculum 行映射并丢弃缺 teclId/课程名的行', () => {
    const courses = parseCurriculumRows({
      data: {
        records: [
          { teclId: 9000, subjCode: 'CS3313', subjName: '计算理论' },
          { teclId: 0, subjName: '无效' },
          { teclId: 9419, subjName: '大模型与智能体工程实践' },
          { subjName: '缺 id' },
        ],
      },
    });
    expect(courses.map((course) => course.teclId)).toEqual([9000, 9419]);
    expect(courses[0]).toMatchObject({ subjCode: 'CS3313', subjName: '计算理论' });
  });

  it('vod 场次行映射状态位（转写/课件）', () => {
    const videos = parseVodRows({
      data: {
        rows: [
          {
            id: 153907,
            teclId: 9000,
            courBeginTime: '2026-09-24 14:00:00',
            letiNumber: 8,
            clroName: '东中院 1-201',
            vodTime: 3258,
            shotImgUrl: 'https://live.sjtu.edu.cn/shot.jpg',
            courTransferFlag: 1,
            coursePptSliceStatus: 5,
          },
          { id: 2, teclId: 9000, courTransferFlag: 0, coursePptSliceStatus: 0 },
        ],
      },
    });
    expect(videos).toHaveLength(2);
    expect(videos[0]).toMatchObject({
      courseId: 153907,
      teclId: 9000,
      beginTime: '2026-09-24 14:00:00',
      letiNumber: 8,
      classroom: '东中院 1-201',
      vodTime: 3258,
      transferReady: true,
      pptReady: true,
    });
    expect(videos[1]).toMatchObject({ transferReady: false, pptReady: false });
  });

  it('播放直链取 courseVodViewList，缺 url 的行丢弃', () => {
    const views = parsePlayViews({
      data: {
        courseVodViewList: [
          { url: 'https://live.sjtu.edu.cn/a.mp4', viewNum: 1, vodTime: 3258 },
          { url: 'https://live.sjtu.edu.cn/b.mp4', viewNum: 5, vodTime: 3258 },
          { viewNum: 9 },
        ],
      },
    });
    expect(views.map((view) => view.viewNum)).toEqual([1, 5]);
    expect(views[0]!.url).toContain('a.mp4');
  });

  it('逐句转写（毫秒）与 PPT 页（秒）映射', () => {
    const lines = parseTranscript({
      data: {
        courseTransferEsDtoList: [
          { bg: 2700, ed: 4200, res: '原来那个他说是真的' },
          { bg: 'x', ed: 1, res: '坏行' },
        ],
      },
    });
    expect(lines).toEqual([{ beginMs: 2700, endMs: 4200, text: '原来那个他说是真的' }]);
    const pages = parsePpt({
      data: {
        docList: [
          { imageUrl: 'https://live/p1.jpg', ocrText: '保存切换更多', imageSeekTime: 7 },
          { imageUrl: 'https://live/p2.jpg', imageSeekTime: 689 },
        ],
      },
    });
    expect(pages).toHaveLength(2);
    expect(pages[0]).toMatchObject({ index: 1, seekTime: 7, ocrText: '保存切换更多' });
  });

  it('mindmap 为 JSON 字符串，时间与子节点按候选键读取', () => {
    const mindmap = JSON.stringify({
      label: '图灵机',
      timeRanges: [{ startTime: 120, endTime: 480 }],
      children: [{ name: '可判定性', timeRanges: [[600, 900]] }],
    });
    const nodes = parseChapters({ data: { mindmap } });
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.ranges).toEqual([{ start: 120, end: 480 }]);
    expect(nodes[0]!.children[0]).toMatchObject({ label: '可判定性' });
    expect(nodes[0]!.children[0]!.ranges).toEqual([{ start: 600, end: 900 }]);
    expect(parseChapters({ data: {} })).toEqual([]);
    expect(parseChapters({ data: { mindmap: 'not-json' } })).toEqual([]);
  });
});

describe('同步与缓存', () => {
  const authorityOk = { code: '0', result: { user: { name: '胡同学' } } };

  function seedCache() {
    db.prepare(
      `INSERT INTO vsjtu_videos VALUES (100, 9000, '2026-09-20 14:00:00', NULL, 6, '旧教室', NULL,
        3000, NULL, 1, 1, '2026-09-20T10:00:00Z')`,
    ).run();
  }

  it('curriculum 同一教学班的多场排课只入库一次，录像翻页拉全', async () => {
    const requestedClasses: Array<string | null> = [];
    netState.respond = (rawUrl) => {
      const url = new URL(rawUrl);
      if (url.pathname.endsWith('authority/me')) return authorityOk;
      if (url.pathname.endsWith('myself/curriculum'))
        return {
          data: {
            records: [
              {
                teclId: 9000,
                subjCode: 'CS3313',
                subjName: '计算理论',
                courBeginTime: '2026-09-24',
              },
              {
                teclId: 9000,
                subjCode: 'CS3313',
                subjName: '计算理论',
                courBeginTime: '2026-10-08',
              },
            ],
          },
        };
      if (url.pathname.endsWith('subject_vod_list_new')) {
        requestedClasses.push(url.searchParams.get('teclIds'));
        const page = Number(url.searchParams.get('page.pageIndex'));
        return {
          data: {
            records:
              page === 1
                ? Array.from({ length: 100 }, (_, index) => ({ id: index + 1, teclId: 9000 }))
                : [{ id: 101, teclId: 9000 }],
          },
        };
      }
      return { data: { acteId: 11 } };
    };
    expect(await syncVsjtu()).toEqual({ ok: true });
    expect(listVsjtu().courses).toEqual([
      expect.objectContaining({ teclId: 9000, videoCount: 101 }),
    ]);
    expect(listVsjtu().videos).toHaveLength(101);
    expect(requestedClasses).toEqual(['9000', '9000']);
  });

  it('录像响应结构变化时报错并保留已有缓存', async () => {
    seedCache();
    netState.respond = (url) => {
      if (url.includes('authority/me')) return authorityOk;
      if (url.includes('myself/curriculum'))
        return { data: [{ teclId: 9000, subjName: '计算理论' }] };
      return { ok: true, data: { unexpected: [] } };
    };
    expect(await syncVsjtu()).toEqual({ ok: false, error: expect.stringContaining('列表') });
    expect(listVsjtu().videos).toHaveLength(1);
  });

  it('成功同步：课程/场次落库并聚合出有录播的课程列表', async () => {
    netState.respond = (url) => {
      if (url.includes('authority/me')) return authorityOk;
      if (url.includes('myself/curriculum'))
        return {
          ok: true,
          data: { records: [{ teclId: 9000, subjCode: 'CS3313', subjName: '计算理论' }] },
        };
      if (url.includes('subject_vod_list_new'))
        return {
          data: {
            records: [
              {
                id: 153907,
                teclId: 9000,
                courBeginTime: '2026-09-24 14:00:00',
                letiNumber: 8,
                courTransferFlag: 1,
                coursePptSliceStatus: 5,
              },
            ],
          },
        };
      if (url.includes('teachingClass')) return { data: { acteId: 11 } };
      return {};
    };
    const result = await syncVsjtu();
    expect(result).toEqual({ ok: true });
    const list = listVsjtu();
    expect(list.courses).toHaveLength(1);
    expect(list.courses[0]).toMatchObject({ teclId: 9000, subjName: '计算理论', videoCount: 1 });
    expect(list.videos[0]).toMatchObject({ courseId: 153907, transferReady: true, pptReady: true });
    expect(
      (
        db.prepare('SELECT acte_id AS acteId FROM vsjtu_sync WHERE id = 1').get() as {
          acteId: string | null;
        }
      ).acteId,
    ).toBe('11');
  });

  it('会话失效（envelope 401）：返回错误并保留既有缓存', async () => {
    seedCache();
    netState.respond = (url) => (url.includes('authority/me') ? { code: '401' } : authorityOk);
    const result = await syncVsjtu();
    expect(result).toEqual({ ok: false, error: expect.stringContaining('重新登录') });
    expect(listVsjtu().videos).toHaveLength(1);
    expect(
      (db.prepare('SELECT error FROM vsjtu_sync WHERE id = 1').get() as { error: string | null })
        .error,
    ).toContain('重新登录');
  });

  it('空响应体（未登录平台返回空）按会话失效处理', async () => {
    netState.respond = () => '';
    const result = await syncVsjtu();
    expect(result).toEqual({ ok: false, error: expect.stringContaining('重新登录') });
  });

  it('课程无录播场次时不进课程列表（JOIN 过滤）', async () => {
    seedCache();
    db.prepare('DELETE FROM vsjtu_videos').run();
    db.prepare("INSERT INTO vsjtu_courses VALUES (9000, 'CS3313', '计算理论')").run();
    expect(listVsjtu().courses).toEqual([]);
    expect(listVsjtu().videos).toEqual([]);
  });
});

describe('来源引用行', () => {
  it('写入引用行（标题含课程/日期/节次），重复添加为更新', () => {
    db.prepare("INSERT INTO vsjtu_courses VALUES (9000, 'CS3313', '计算理论')").run();
    db.prepare(
      `INSERT INTO vsjtu_videos VALUES (153907, 9000, '2026-09-24 14:00:00', NULL, 8, '东中院', NULL,
        3258, NULL, 1, 1, '2026-09-24T10:00:00Z')`,
    ).run();
    const ref = addVsjtuSourceRef(153907);
    expect(ref.title).toBe('计算理论 2026-09-24 第8节');
    expect(ref.courseName).toBe('计算理论');
    expect(getVsjtuSourceRef(153907)?.videoId).toBe(153907);
  });

  it('缓存缺失时明确报错，不伪造引用', () => {
    expect(() => addVsjtuSourceRef(404)).toThrow('不在本地缓存');
  });
});
