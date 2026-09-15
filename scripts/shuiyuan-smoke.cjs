// 水源视图冒烟：隔离 userData + 假 IPC 桩，覆盖信息流渲染、分页、阅读页推入、
// 引用回复、通知已读、搜索切换。不访问真实凭据与网络。
const { app, BrowserWindow, ipcMain } = require('electron');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const assert = require('node:assert/strict');
const root = resolve('.');
const profile = mkdtempSync(join(tmpdir(), 'dela-shuiyuan-'));
app.setPath('userData', profile);

const iso = (minutesAgo) => new Date(Date.now() - minutesAgo * 60000).toISOString();
const topic = (id, title, extra = {}) => ({
  id,
  title,
  excerpt: null,
  categoryId: 1,
  tags: ['经验分享'],
  postsCount: 3,
  views: 1234,
  likeCount: 2,
  createdAt: iso(600),
  lastPostedAt: iso(30),
  pinned: false,
  closed: false,
  bookmarked: false,
  archetype: 'regular',
  lastPosterUsername: 'tester',
  ...extra,
});
const post = (id, number, username, cooked) => ({
  id,
  postNumber: number,
  username,
  name: null,
  avatarTemplate: null,
  createdAt: iso(60),
  cooked,
  replyToPostNumber: null,
  likeCount: 1,
  yours: false,
});

const pageOne = {
  topics: [topic(101, '置顶公告帖', { pinned: true }), topic(102, '考试经验分享帖')],
  moreUrl: '/latest.json?page=1',
};
const pageTwo = { topics: [topic(103, '第二页帖子')], moreUrl: null };
const searchPage = {
  topics: [topic(104, '搜索结果帖', { excerpt: '数据结构 往年题' })],
  moreUrl: null,
};
const detail = {
  id: 101,
  title: '置顶公告帖',
  categoryId: 1,
  tags: ['经验分享'],
  postsCount: 2,
  likeCount: 2,
  views: 99,
  createdAt: iso(600),
  lastPostedAt: iso(30),
  closed: false,
  archetype: 'regular',
  bookmarked: false,
  stream: [1, 2],
  posts: [post(1, 1, '楼主', '<p>正文第一楼</p>'), post(2, 2, '层友', '<p>这里是回复内容</p>')],
};
let notifications = [
  {
    id: 1,
    type: 5,
    read: false,
    highPriority: false,
    createdAt: iso(10),
    topicId: 101,
    postNumber: 2,
    fancyTitle: '置顶公告帖',
    displayUsername: '点赞人',
  },
  {
    id: 2,
    type: 2,
    read: true,
    highPriority: false,
    createdAt: iso(200),
    topicId: 102,
    postNumber: 1,
    fancyTitle: '考试经验分享帖',
    displayUsername: '提及人',
  },
];
const listCalls = [];

const routes = {
  'workspace:get-state': () => ({ entries: [], directory: '', views: {} }),
  'canvas:get-state': () => ({ connected: false, courses: [], items: [] }),
  'window:get-state': () => ({ maximized: false }),
  'settings:get-theme': () => 'light',
  'settings:get-zoom': () => 1,
  'settings:get-font-scale': () => 1,
  'workspace:get-chat': () => ({
    sessionId: null,
    configured: false,
    providerName: null,
    model: '',
    models: [],
    messages: [],
  }),
  'shuiyuan:get-state': () => ({ connected: true, username: 'tester', boundAt: iso(90) }),
  'shuiyuan:site-structure': () => ({
    categories: [
      {
        id: 1,
        name: '校园生活',
        slug: 'campus-life',
        color: '0088cc',
        parentId: null,
        topicCount: 9,
      },
      { id: 2, name: '失物招领', slug: 'lost', color: 'aa0000', parentId: 1, topicCount: 3 },
    ],
    tags: [
      { name: '经验分享', topicCount: 9 },
      { name: '转载', topicCount: 3 },
    ],
  }),
  'shuiyuan:get-counts': () => ({
    notifications: notifications.filter((n) => !n.read).length,
    messages: 1,
  }),
  'shuiyuan:list-topics': (_event, feed, moreUrl) => {
    listCalls.push(JSON.stringify({ feed, moreUrl: moreUrl ?? null }));
    if (feed?.kind === 'search') return searchPage;
    return moreUrl ? pageTwo : pageOne;
  },
  'shuiyuan:get-topic': (_event, id) => (id === 101 ? detail : { ...detail, id }),
  'shuiyuan:list-notifications': () => notifications,
  'shuiyuan:mark-notifications-read': () => {
    notifications = notifications.map((item) => ({ ...item, read: true }));
    return null;
  },
};
for (const [name, handler] of Object.entries(routes)) ipcMain.handle(name, handler);

app
  .whenReady()
  .then(async () => {
    const win = new BrowserWindow({
      width: 1200,
      height: 900,
      show: false,
      webPreferences: {
        preload: join(root, 'out/preload/index.cjs'),
        sandbox: true,
        contextIsolation: true,
        backgroundThrottling: false,
        offscreen: true,
      },
    });
    const errors = [];
    win.webContents.on('console-message', (event) => {
      if (event.level === 'error') errors.push(event.message);
    });
    const evaluate = (code) => win.webContents.executeJavaScript(code, true);
    const pause = () => new Promise((r) => setTimeout(r, 150));
    const wait = async (code) => {
      for (let i = 0; i < 80; i++) {
        if (await evaluate(code)) return;
        await pause();
      }
      throw Error(
        `Timed out: ${code}\n${errors.join('\n')}\n${await evaluate('document.body.innerText')}`,
      );
    };
    const click = async (code) => {
      assert.ok(await evaluate(code), `missing target: ${code}`);
      await evaluate(`${code}.click()`);
      await pause();
    };

    await win.loadFile(join(root, 'out/renderer/index.html'), { query: { 'smoke-test': '1' } });
    await wait('document.querySelector(\'aside[aria-label=\\"主导航\\"]\')');
    await click(
      "[...document.querySelectorAll('aside[aria-label=\\\"主导航\\\"] nav[aria-label=功能导航] button')].find(b => b.textContent.includes('水源'))",
    );

    // 信息流：表头、两个主题行、类别色点、未读徽标。
    await wait(
      "document.body.innerText.includes('置顶公告帖') && document.body.innerText.includes('考试经验分享帖')",
    );
    assert.ok(
      await evaluate(
        "document.body.innerText.includes('最新') && document.body.innerText.includes('精品')",
      ),
    );
    assert.ok(
      await evaluate(
        "[...document.querySelectorAll('span[style]')].some(el => getComputedStyle(el).backgroundColor === 'rgb(0, 136, 204)')",
      ),
      'category color dot',
    );
    assert.ok(
      await evaluate("[...document.querySelectorAll('button[title=通知]')].length === 1"),
      '通知入口',
    );
    assert.match(await evaluate("document.querySelector('button[title=通知]').textContent"), /1/);

    // 分页：加载更多追加第二页并移除按钮。
    await click(
      "document.querySelector('button') && [...document.querySelectorAll('button')].find(b => b.textContent.includes('加载更多'))",
    );
    await wait("document.body.innerText.includes('第二页帖子')");
    assert.ok(
      !(await evaluate(
        "[...document.querySelectorAll('button')].some(b => b.textContent.includes('加载更多'))",
      )),
      'load-more button should disappear after last page',
    );

    // 阅读页推入：返回按钮、楼层 iframe、标题。
    await click(
      "[...document.querySelectorAll('button')].find(b => b.textContent.includes('置顶公告帖'))",
    );
    await wait('document.querySelector(\'[aria-label=\\"返回信息流\\"]\')');
    assert.equal(
      await evaluate('document.querySelectorAll(\'iframe[title^=\\"第\\"]\').length'),
      2,
    );
    assert.ok(
      await evaluate("document.body.innerText.includes('正文第一楼') === false"),
      'content stays inside iframe',
    );

    // 引用按钮：展开回复器并插入引用文本。
    await click('document.querySelector(\'[aria-label=\\"引用第 1 楼\\"]\')');
    await wait("document.querySelector('.cm-content')");
    assert.match(await evaluate("document.querySelector('.cm-content').innerText"), /楼主/);

    // 返回信息流。
    await click('document.querySelector(\'[aria-label=\\"返回信息流\\"]\')');
    await wait("document.body.innerText.includes('考试经验分享帖')");

    // 通知：未读点、全部已读后消失。
    await click("document.querySelector('button[title=通知]')");
    await wait("document.body.innerText.includes('点赞人')");
    assert.ok(
      await evaluate(
        "document.querySelector('button[title=通知] + * , button[title=通知]') && document.body.innerText.includes('提到了你')",
      ),
    );
    await click(
      "[...document.querySelectorAll('button')].find(b => b.textContent.includes('全部标为已读'))",
    );
    await wait(
      "![...document.querySelectorAll('button')].some(b => b.textContent.includes('全部标为已读'))",
    );

    // 搜索：输入后 400ms 防抖切换到搜索 feed。
    await evaluate(`(() => {
      const input = document.querySelector('input[aria-label=搜索水源]');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, '数据结构');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await wait("document.body.innerText.includes('搜索结果帖')");
    assert.ok(
      listCalls.some((call) => JSON.parse(call).feed?.kind === 'search'),
      'search feed requested',
    );

    assert.deepEqual(errors, [], 'renderer console errors');
    console.log(
      'Shuiyuan smoke check passed: feed, pagination, reader, quote, notifications, search.',
    );
    win.destroy();
    app.exit(0);
  })
  .catch((error) => {
    console.error('SHUIYUAN SMOKE FAIL', error);
    app.exit(1);
  })
  .finally(() => {
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch {
      /* Windows 下 Electron 可能仍占用 profile，留给系统临时目录清理。 */
    }
  });
