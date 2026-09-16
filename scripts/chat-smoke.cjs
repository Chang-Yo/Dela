const { app, BrowserWindow, ipcMain } = require('electron');
const { mkdtempSync, mkdirSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const assert = require('node:assert/strict');
const root = resolve('.');
app.setPath('userData', mkdtempSync(join(tmpdir(), 'dela-chat-')));
const chat = {
  sessionId: 'fixture',
  configured: true,
  model: 'Preview',
  models: [],
  providerName: 'Fixture',
  messages: [],
  running: false,
};
const routes = {
  'workspace:get-state': () => ({ entries: [], directory: '', views: {} }),
  'canvas:get-state': () => ({ connected: false, courses: [], items: [] }),
  'window:get-state': () => ({ maximized: false }),
  'settings:get-theme': () => 'light',
  'settings:get-zoom': () => 1,
  'settings:get-font-scale': () => 1,
  'workspace:get-chat': () => chat,
  'llm:list': () => [],
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
        `Timed out: ${code}\n${errors.join('\n')}\n${await evaluate('document.querySelector("[aria-label=对话消息]")?.innerHTML')}`,
      );
    };
    const push = async () => {
      win.webContents.send('workspace:chat-update', 'home', structuredClone(chat));
      await pause();
    };
    await win.loadFile(join(root, 'out/renderer/index.html'), { query: { 'smoke-test': '1' } });
    await wait("document.querySelector('textarea')");
    // 提供商未开启推理强度时，composer 的思考强度控件显示 default 且不可改。
    assert.ok(
      await evaluate("document.querySelector('button[aria-label=思考强度]') !== null"),
      'effort control missing',
    );
    assert.equal(
      await evaluate(
        "document.querySelector('button[aria-label=思考强度]')?.textContent.includes('default')",
      ),
      true,
    );
    assert.equal(
      await evaluate("document.querySelector('button[aria-label=思考强度]')?.disabled"),
      true,
    );
    chat.messages.push({ role: 'user', content: '帮我整理课程资料，保存本周复习计划。' });
    const reply = {
      role: 'assistant',
      content: '',
      parts: [],
      toolResults: [],
      startedAt: Date.now(),
    };
    chat.messages.push(reply);
    chat.running = true;
    await push();
    await wait("document.querySelector('[aria-label=对话消息]')");
    const viewport = "document.querySelector('[aria-label=对话消息]')";
    const initialTop = await evaluate(`${viewport}.scrollTop`);
    // 思考段先于公开正文流式进入：块自动展开，正文到达后自动收起为“已思考 · X 秒”。
    const thinkStart = Date.now();
    reply.parts.push({
      type: 'reasoning',
      text: '先分析请求：需要查找课程资料，再保存复习计划。',
      startedAt: thinkStart,
    });
    await push();
    await wait(
      "[...document.querySelectorAll('[data-reasoning-body]')].some(el => el.textContent.includes('先分析请求') && el.parentElement.getBoundingClientRect().height > 1)",
    );
    reply.parts[0].finishedAt = thinkStart + 3200;
    reply.parts.push({ type: 'text', text: '我会先查找课程资料，再按课程整理复习重点。' });
    await push();
    await wait("document.body.innerText.includes('已思考 · 3 秒')");
    await wait(
      "[...document.querySelectorAll('[data-reasoning-body]')].every(el => el.parentElement.getBoundingClientRect().height < 1)",
    );
    chat.activeTool = 'search_sources';
    // 新协议：工具开始即写入无输出的占位步骤（带输入摘要与 startedAt）。
    const runStart = Date.now();
    reply.parts.push({
      type: 'tools',
      results: [
        { id: 'run1', name: 'search_sources', input: { query: '本周课程' }, startedAt: runStart },
      ],
    });
    await push();
    await wait("document.body.innerText.includes('正在查找资料')");
    // 运行中的组自动展开：占位步骤的输入摘要直接可见。
    await wait(
      "[...document.querySelectorAll('span')].some(el => el.textContent === '「本周课程」' && el.checkVisibility())",
    );
    // 消息头的“正在工作 · N 秒”每秒跳动。
    const workingLabel = () =>
      evaluate(
        "[...document.querySelectorAll('span')].find(el => el.textContent.startsWith('正在工作'))?.textContent",
      );
    const tick1 = await workingLabel();
    assert.match(tick1, /^正在工作 · \d+ 秒$/);
    await new Promise((r) => setTimeout(r, 1600));
    const tick2 = await workingLabel();
    assert.notEqual(tick2, tick1, 'working timer did not tick');
    const first = {
      id: 'run1',
      name: 'search_sources',
      input: { query: '本周课程' },
      output: { ok: true, result: { count: 3 } },
      startedAt: runStart,
      finishedAt: runStart + 2100,
    };
    reply.parts.at(-1).results[0] = first;
    reply.toolResults.push(first);
    chat.activeTool = undefined;
    await push();
    await wait("document.body.innerText.includes('已执行 1 个动作')");
    // 完成后未触碰的组自动收起：折叠容器高度归零（内层 ol 保留固有高度，测父容器），摘要行仍在。
    await wait(
      "[...document.querySelectorAll('ol[aria-label=动作时间线]')].every(ol => ol.parentElement.getBoundingClientRect().height < 1)",
    );
    await evaluate(
      "[...document.querySelectorAll('button')].find(b => b.textContent.includes('已执行 1 个动作')).click()",
    );
    // 展开后可见占位时输入的摘要与每步耗时（startedAt→finishedAt 差值 2 秒）。
    await wait(
      "[...document.querySelectorAll('span')].some(el => el.textContent === '「本周课程」' && el.checkVisibility())",
    );
    assert.match(
      await evaluate(
        "[...document.querySelectorAll('button')].find(b => b.textContent.includes('查找资料'))?.textContent",
      ),
      /2 秒/,
    );
    reply.parts.push({ type: 'text', text: '已找到 **三份资料' });
    await push();
    await wait(
      "[...document.querySelectorAll('[data-streamdown=strong]')].some(el => el.textContent === '三份资料')",
    );
    reply.parts.at(-1).text = '已找到 **三份资料**，接下来保存复习计划。';
    await push();
    assert.equal(
      await evaluate(`${viewport}.scrollTop`),
      initialTop,
      'stream moved the reading position',
    );
    const second = {
      id: 'write',
      name: 'write_note',
      input: { title: '本周复习计划' },
      output: { ok: true, result: { saved: true } },
    };
    const failed = {
      id: 'fail',
      name: 'read_resource',
      input: { id: 'missing' },
      output: { ok: false, error: { message: '资料尚未下载' } },
    };
    reply.parts.push({ type: 'tools', results: [second, failed] });
    reply.toolResults.push(second, failed);
    reply.parts.push({
      type: 'text',
      text: '已保存复习计划：\n\n- 周一：复习课程概念\n- 周三：完成练习\n- 周五：整理疑问\n\n一份资料尚未下载，未纳入本次整理。',
    });
    reply.content = reply.parts
      .filter((p) => p.type === 'text')
      .map((p) => p.text)
      .join('\n\n');
    await push();
    const beforeFinish = await evaluate(`${viewport}.scrollTop`);
    chat.running = false;
    reply.finishedAt = reply.startedAt + 12400;
    await push();
    assert.equal(
      await evaluate(`${viewport}.scrollTop`),
      beforeFinish,
      'completion moved the viewport',
    );
    const body = await evaluate('document.body.innerText');
    assert.ok(body.indexOf('我会先') < body.indexOf('已执行 1 个动作'));
    assert.ok(body.indexOf('已执行 1 个动作') < body.indexOf('已找到'));
    assert.ok(body.includes('1 个失败'));
    assert.ok(!body.includes('▍'));
    await evaluate(
      "[...document.querySelectorAll('button')].find(b => b.textContent.includes('已执行 2 个动作')).click()",
    );
    await wait("document.body.innerText.includes('资料尚未下载')");
    await evaluate(
      "[...document.querySelectorAll('button')].find(b => b.textContent.includes('读取资料')).click()",
    );
    await wait(
      "[...document.querySelectorAll('pre')].some(p => p.textContent.includes('missing') && p.checkVisibility())",
    );
    mkdirSync(join(root, 'output/playwright'), { recursive: true });
    for (const [width, theme] of [
      [1200, 'light'],
      [900, 'dark'],
      [600, 'light'],
    ]) {
      win.setSize(width, 900);
      await evaluate(
        `document.documentElement.classList.toggle('dark', ${theme === 'dark'}); document.documentElement.classList.toggle('light', ${theme === 'light'})`,
      );
      await pause();
      assert.ok(
        await evaluate(`${viewport}.scrollWidth <= ${viewport}.clientWidth + 1`),
        `horizontal overflow at ${width}`,
      );
      writeFileSync(
        join(root, `output/playwright/chat-${width}-${theme}.png`),
        (await win.webContents.capturePage()).toPNG(),
      );
    }
    // Long stream: reading remains stationary; explicitly following the bottom tracks growth.
    chat.running = true;
    delete reply.finishedAt;
    reply.parts.at(-1).text += '\n\n' + '长回答段落，用于验证阅读位置。\n\n'.repeat(60);
    await push();
    await wait("document.querySelector('[aria-label=回到底部]')");
    await evaluate("document.querySelector('[aria-label=回到底部]').click()");
    await new Promise((r) => setTimeout(r, 700));
    reply.parts.at(-1).text += '\n\n后续输出。'.repeat(20);
    await push();
    assert.ok(
      await evaluate(
        `${viewport}.scrollHeight - ${viewport}.scrollTop - ${viewport}.clientHeight < 30`,
      ),
    );
    await evaluate(
      `${viewport}.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true })); ${viewport}.scrollTop = 100`,
    );
    reply.parts.at(-1).text += '\n\n更多输出。'.repeat(20);
    await push();
    assert.equal(await evaluate(`${viewport}.scrollTop`), 100);
    // Legacy history and switching must not inherit disclosure state or invent lost text.
    chat.running = false;
    chat.sessionId = 'legacy';
    chat.messages = [
      { role: 'user', content: '旧问题' },
      { role: 'assistant', content: '旧回答', toolResults: [first] },
    ];
    await push();
    await wait("document.body.innerText.includes('旧回答')");
    assert.ok(!(await evaluate("document.body.innerText.includes('我会先')")));
    // Draft persistence: input survives leaving and re-entering the chat view.
    win.setSize(1200, 900);
    await pause();
    const draftText = '草稿保留验证';
    await evaluate(`(() => {
      const ta = document.querySelector('textarea');
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, ${JSON.stringify(draftText)});
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    assert.equal(await evaluate('document.querySelector("textarea").value'), draftText);
    assert.ok(
      ((await evaluate('localStorage.getItem("dela.chat.drafts")')) ?? '').includes(draftText),
      'draft not written to localStorage',
    );
    const clickNav = (label) =>
      evaluate(`(() => {
        const b = [...document.querySelectorAll('nav[aria-label="功能导航"] button')]
          .find((item) => item.textContent.includes(${JSON.stringify(label)}));
        if (!b) return 'not-found';
        b.click();
        return 'clicked';
      })()`);
    assert.equal(await clickNav('项目'), 'clicked', 'projects nav missing');
    // 侧栏 aria-current 立即变化；等首页对话流随退场动画确实卸载后再取项目页状态。
    await wait('document.querySelector(\'[aria-label="对话消息"]\') === null');
    assert.notEqual(
      await evaluate('document.querySelector("textarea")?.value'),
      draftText,
      'projects view shares the home composer draft',
    );
    assert.equal(await clickNav('首页'), 'clicked', 'home nav missing');
    await wait("document.querySelector('textarea')");
    assert.equal(
      await evaluate('document.querySelector("textarea")?.value'),
      draftText,
      'draft lost after switching away and back',
    );
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log(
      'Chat smoke passed: ordered parts, reasoning collapse, streaming Markdown, failures, disclosures, working timer, auto collapse, per-step duration, stable scroll, follow/escape, legacy sessions, draft persistence, 3 widths, light/dark.',
    );
    win.destroy();
    app.exit(0);
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
