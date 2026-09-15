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
    reply.parts.push({ type: 'text', text: '我会先查找课程资料，再按课程整理复习重点。' });
    await push();
    chat.activeTool = 'search_sources';
    reply.parts.push({ type: 'tools', results: [] });
    await push();
    await wait("document.body.innerText.includes('正在查找资料')");
    const first = {
      id: 'read',
      name: 'search_sources',
      input: { query: '本周课程' },
      output: { ok: true, result: { count: 3 } },
    };
    reply.parts.at(-1).results.push(first);
    reply.toolResults.push(first);
    chat.activeTool = undefined;
    await push();
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
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log(
      'Chat smoke passed: ordered parts, streaming Markdown, failures, disclosures, stable scroll, follow/escape, legacy sessions, 3 widths, light/dark.',
    );
    win.destroy();
    app.exit(0);
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
