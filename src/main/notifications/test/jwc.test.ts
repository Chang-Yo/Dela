import Database from 'better-sqlite3';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { isPackaged: true }, dialog: { showSaveDialog: vi.fn() } }));
vi.mock('../../database', () => ({ getDatabase: vi.fn() }));
vi.mock('../system', () => ({ systemNotifyItem: vi.fn() }));
vi.mock('node:fs/promises', () => ({ writeFile: vi.fn() }));

import { app, dialog } from 'electron';
import { writeFile } from 'node:fs/promises';
import { getDatabase } from '../../database';
import { systemNotifyItem } from '../system';
import {
  parseJwcList,
  refreshJwc,
  getJwcNotice,
  getJwcCaptcha,
  downloadJwcAttachment,
} from '../jwc';

let db: Database.Database;
const request = vi.fn<typeof fetch>();
const origin = 'https://jwc.sjtu.edu.cn';
const row = (id: number, day = '28', month = '2026.10', dynamic = false) =>
  `<li><div class="sj"><h2>${day}</h2><p>${month}</p></div><div class="wz"><a href="${dynamic ? `/content.jsp?urltype=news.NewsContentUrl&wbnewsid=${id}` : `/info/1222/${id}.htm`}"><h2>通知 ${id}</h2></a><p>摘要 &amp; 内容</p></div></li>`;
const list = (rows: string, next = '') =>
  `<div class="ny_right_con"><div class="Newslist"><ul>${rows}</ul></div></div>${next ? `<span class="p_next"><a href="${next}">下页</a></span>` : ''}`;
const page = (html: string) => new Response(html, { headers: { ETag: '"v1"' } });

beforeEach(() => {
  vi.clearAllMocks();
  request.mockReset();
  vi.stubGlobal('fetch', request);
  vi.stubEnv('DELA_DEV_URL', '');
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-02T04:00:00Z'));
  Object.defineProperty(app, 'isPackaged', { value: true, configurable: true });
  db = new Database(':memory:');
  db.exec(`CREATE TABLE workspace_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE notifications (id TEXT PRIMARY KEY, source TEXT, account_key TEXT, title TEXT, body TEXT, created_at TEXT, read_at TEXT, source_unread INTEGER, href TEXT);
    CREATE TABLE notification_refreshes (source TEXT, account_key TEXT, last_success_at TEXT, error TEXT, PRIMARY KEY(source, account_key));`);
  vi.mocked(getDatabase).mockReturnValue(db);
});
afterEach(() => {
  db.close();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it('识别两种文章地址、日期、摘要与真实下页地址', () => {
  const result = parseJwcList(
    list(row(1) + row(2, '28', '2026.10', true), 'mxxsdtz/98.htm'),
    `${origin}/index/mxxsdtz.htm`,
  );
  expect(result.items.map((item) => item.id)).toEqual(['jwc:1', 'jwc:2']);
  expect(result.items[0]).toMatchObject({
    createdAt: '2026-10-27T16:00:00.000Z',
    body: '摘要 & 内容',
  });
  expect(result.next).toBe(`${origin}/index/mxxsdtz/98.htm`);
  expect(() => parseJwcList('<html>维护中</html>', origin)).toThrow('未能读取');
});

it('学校列表中的公众号外链沿用学校文章 ID，不阻断其他通知', () => {
  const html =
    list(row(3).replace('/info/1222/3.htm', 'https://mp.weixin.qq.com/s/example')) +
    `<script>_showDynClickBatch(['dynclicks_u9_3'],[3],"wbnews",1707467176)</script>`;
  expect(parseJwcList(html, origin).items[0]).toMatchObject({
    id: 'jwc:3',
    href: { kind: 'jwc', url: 'https://mp.weixin.qq.com/s/example' },
  });
});

it('首次导入历史不提醒，此后同日新增文章仅收集一次，304 不清除数据', async () => {
  request.mockResolvedValueOnce(page(list(row(1))));
  await refreshJwc(true);
  expect(db.prepare('SELECT * FROM notifications').all()).toHaveLength(1);
  expect(systemNotifyItem).not.toHaveBeenCalled();
  request.mockResolvedValueOnce(page(list(row(2) + row(1))));
  await refreshJwc(true);
  expect(db.prepare('SELECT id FROM notifications ORDER BY id').all()).toEqual([
    { id: 'jwc:1' },
    { id: 'jwc:2' },
  ]);
  expect(systemNotifyItem).toHaveBeenCalledTimes(1);
  request.mockResolvedValueOnce(new Response(null, { status: 304 }));
  await refreshJwc(true);
  expect(request.mock.calls[2]![1]!.headers).toMatchObject({ 'If-None-Match': '"v1"' });
  expect(db.prepare('SELECT id FROM notifications').all()).toHaveLength(2);
  await refreshJwc();
  expect(request).toHaveBeenCalledTimes(3);
});

it.each([true, false])('首次导入近两个月通知且不提醒（正式版：%s）', async (isPackaged) => {
  Object.defineProperty(app, 'isPackaged', { value: isPackaged });
  vi.stubEnv('DELA_DEV_URL', isPackaged ? '' : 'http://127.0.0.1:5173');
  request
    .mockResolvedValueOnce(page(list(row(10), 'mxxsdtz/98.htm')))
    .mockResolvedValueOnce(page(list(row(9, '02', '2026.09') + row(8, '01', '2026.09'), '97.htm')));
  await refreshJwc(true);
  expect(db.prepare('SELECT id FROM notifications ORDER BY id').all()).toEqual([
    { id: 'jwc:10' },
    { id: 'jwc:9' },
  ]);
  expect(request).toHaveBeenCalledTimes(2);
  expect(systemNotifyItem).not.toHaveBeenCalled();
  request.mockResolvedValueOnce(new Response(null, { status: 304 }));
  await refreshJwc(true);
  expect(request).toHaveBeenCalledTimes(3);
});

it('不启动已停用的教务处刷新', async () => {
  await refreshJwc(true, () => false);
  expect(request).not.toHaveBeenCalled();
  expect(db.prepare('SELECT * FROM workspace_settings').all()).toEqual([]);
  expect(db.prepare('SELECT * FROM notification_refreshes').all()).toEqual([]);
});

it.each(['success', 'not-modified', 'failure', 'response-body'] as const)(
  '刷新期间关闭教务处订阅时丢弃 %s 结果，重新开启可立即刷新',
  async (outcome) => {
    let enabled = true;
    const isCurrent = () => enabled;
    request.mockResolvedValueOnce(page(list(row(1))));
    await refreshJwc(true);
    const notifications = db.prepare('SELECT * FROM notifications').all();
    const saved = db.prepare("SELECT value FROM workspace_settings WHERE key = 'jwc-sync'").get();
    const refreshes = db.prepare('SELECT * FROM notification_refreshes').all();
    vi.setSystemTime(new Date(Date.now() + 21 * 60_000));

    let finish!: (response: Response) => void;
    let fail!: (error: Error) => void;
    let finishBody!: (html: string) => void;
    const response = page(list(row(2) + row(1)));
    const readBody = vi.spyOn(response, 'text');
    if (outcome === 'response-body') {
      readBody.mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            finishBody = resolve;
          }),
      );
      request.mockResolvedValueOnce(response);
    } else {
      request.mockImplementationOnce(
        () =>
          new Promise<Response>((resolve, reject) => {
            finish = resolve;
            fail = reject;
          }),
      );
    }

    const refreshing = refreshJwc(false, isCurrent);
    if (outcome === 'response-body') await vi.waitFor(() => expect(readBody).toHaveBeenCalled());
    enabled = false;
    if (outcome === 'response-body') finishBody(list(row(2) + row(1)));
    else if (outcome === 'failure') fail(new Error('network failed'));
    else finish(outcome === 'not-modified' ? new Response(null, { status: 304 }) : response);
    await refreshing;

    expect(db.prepare('SELECT * FROM notifications').all()).toEqual(notifications);
    expect(db.prepare("SELECT value FROM workspace_settings WHERE key = 'jwc-sync'").get()).toEqual(
      saved,
    );
    expect(db.prepare('SELECT * FROM notification_refreshes').all()).toEqual(refreshes);
    expect(systemNotifyItem).not.toHaveBeenCalled();

    enabled = true;
    request.mockResolvedValueOnce(page(list(row(2) + row(1))));
    await refreshJwc(false, isCurrent);
    expect(request).toHaveBeenCalledTimes(3);
    expect(db.prepare('SELECT id FROM notifications ORDER BY id').all()).toEqual([
      { id: 'jwc:1' },
      { id: 'jwc:2' },
    ]);
    expect(systemNotifyItem).toHaveBeenCalledTimes(1);
  },
);

it('首次忽略的过期首页通知不会在后续刷新时作为新通知导入', async () => {
  request.mockImplementation(async () => page(list(row(9, '01', '2026.09'))));
  await refreshJwc(true);
  await refreshJwc(true);
  expect(db.prepare('SELECT id FROM notifications').all()).toHaveLength(0);
  expect(systemNotifyItem).not.toHaveBeenCalled();
});

it('北京时间刚跨日时按当地日期保留两个月前当天的通知', async () => {
  vi.setSystemTime(new Date('2026-11-01T16:30:00Z'));
  request.mockResolvedValueOnce(page(list(row(9, '02', '2026.09') + row(8, '01', '2026.09'))));
  await refreshJwc(true);
  expect(db.prepare('SELECT id FROM notifications').all()).toEqual([{ id: 'jwc:9' }]);
  expect(systemNotifyItem).not.toHaveBeenCalled();
});

it('列表读取失败不推进基线，下次成功仍可发现新增', async () => {
  request.mockResolvedValueOnce(page(list(row(1))));
  await refreshJwc(true);
  const before = db.prepare('SELECT value FROM workspace_settings').get();
  request.mockResolvedValueOnce(page('<h1>服务不可用</h1>'));
  await refreshJwc(true);
  expect(db.prepare('SELECT value FROM workspace_settings').get()).toEqual(before);
  expect(db.prepare('SELECT error FROM notification_refreshes').get()).toMatchObject({
    error: '未能读取教务处通知列表',
  });
});

it('保留正文表格图片、识别附件，并在同一会话提交验证码后保存真实文件', async () => {
  db.prepare(
    'INSERT INTO notifications (id, source, title, created_at, href) VALUES (?, ?, ?, ?, ?)',
  ).run(
    'jwc:991',
    'jwc',
    '通知',
    '2026-10-28',
    JSON.stringify({ kind: 'jwc', url: `${origin}/info/1222/991.htm` }),
  );
  request.mockResolvedValueOnce(
    page(
      '<div class="v_news_content"><table><tr><td>考试</td></tr></table><img src="/image.png"></div><div class="Newslist2"><a href="/system/_content/download.jsp?wbfileid=ABC">说明.pdf</a></div>',
    ),
  );
  const notice = await getJwcNotice('jwc:991');
  expect(notice.html).toContain('<table>');
  expect(notice.html).toContain('/image.png');
  expect(notice.attachments[0]).toMatchObject({ id: 'ABC', name: '说明.pdf' });
  request
    .mockResolvedValueOnce(
      new Response('验证码页面', {
        headers: { 'Set-Cookie': 'JSESSIONID=test-session; Path=/; HttpOnly' },
      }),
    )
    .mockResolvedValueOnce(
      new Response(new Uint8Array([255, 216, 255]), { headers: { 'Content-Type': 'image/jpeg' } }),
    );
  const captcha = await getJwcCaptcha('jwc:991', 'ABC');
  expect(captcha.image).toContain('data:image/jpeg;base64,');
  request.mockResolvedValueOnce(
    new Response('<h1>验证码错误</h1>', { headers: { 'Content-Type': 'text/html' } }),
  );
  expect(await downloadJwcAttachment(captcha.token, '0000')).toEqual({ status: 'invalid-code' });
  expect(dialog.showSaveDialog).not.toHaveBeenCalled();
  request.mockResolvedValueOnce(
    new Response('%PDF-1.7\n%%EOF', {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': 'attachment; filename=guide.pdf',
      },
    }),
  );
  vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: false, filePath: 'saved.pdf' });
  expect(await downloadJwcAttachment(captcha.token, '1234')).toEqual({ status: 'saved' });
  expect(request.mock.calls.at(-1)![0]!.toString()).toContain('codeValue=1234');
  expect(request.mock.calls.at(-1)![1]!.headers).toMatchObject({
    Cookie: 'JSESSIONID=test-session',
  });
  expect(writeFile).toHaveBeenCalledWith('saved.pdf', Buffer.from('%PDF-1.7\n%%EOF'));
});
