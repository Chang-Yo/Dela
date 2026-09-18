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
  effortLevels: [],
  effort: null,
  messages: [],
  running: false,
};
const routes = {
  'workspace:get-state': () => ({
    entries: [
      {
        id: '11111111-1111-1111-1111-111111111111',
        parentId: null,
        kind: 'note',
        name: '测试笔记',
        sourceId: null,
        noteId: null,
        updatedAt: '2026-09-18T00:00:00.000Z',
      },
    ],
    directory: '',
    views: {},
  }),
  'canvas:get-state': () => ({ connected: false, courses: [], items: [] }),
  'window:get-state': () => ({ maximized: false }),
  'settings:get-theme': () => 'light',
  'settings:get-zoom': () => 1,
  'settings:get-font-scale': () => 1,
  'workspace:get-chat': () => chat,
  'llm:list': () => [],
  'chat:list-commands': () => [],
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
    // smoke-test 查询参数跳过首启引导；隔离档案不会出现真实 onboarding 状态。
    await win.loadFile(join(root, 'out/renderer/index.html'), { query: { 'smoke-test': '1' } });
    await wait('document.querySelector(\'.cm-content[aria-label="发送给助手"]\')');
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
    // Composer 候选菜单：空查询的 / 与 @ 都应立即打开候选，选择项替换触发词。
    // IIFE 包裹：executeJavaScript 在全局作用域执行，裸 const 会因重复声明抛错。
    const editComposer = (text) =>
      `(() => {
        const editor = document.querySelector('.cm-content[aria-label="发送给助手"]');
        editor.focus();
        document.execCommand('selectAll');
        document.execCommand('insertText', false, ${JSON.stringify(text)});
      })()`;
    await evaluate(editComposer('/'));
    await wait("document.body.innerText.includes('/日程')");
    await evaluate(
      "[...document.querySelectorAll('button')].find(b => b.textContent.includes('/日程')).click()",
    );
    await wait("document.body.innerText.includes('帮我查看本周的日程安排')");
    await evaluate(editComposer('@'));
    await wait("document.body.innerText.includes('测试笔记')");
    await evaluate(
      "[...document.querySelectorAll('button')].find(b => b.textContent.includes('测试笔记')).click()",
    );
    await wait('document.querySelector(\'button[aria-label="移除引用 测试笔记"]\') !== null');
    await evaluate(editComposer(''));
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
    // 思考段先于公开正文流式进入：块自动展开；正文到达后自动收起，可手动再展开。
    reply.parts.push({
      type: 'reasoning',
      text: '先分析请求：需要查找课程资料，再保存复习计划。',
      startedAt: Date.now(),
    });
    await push();
    await wait("document.body.innerText.includes('思考中…')");
    await wait(
      "[...document.querySelectorAll('[data-reasoning-body]')].some(el => el.textContent.includes('先分析请求') && el.parentElement.getBoundingClientRect().height > 1)",
    );
    reply.parts.push({ type: 'text', text: '我会先查找课程资料，再按课程整理复习重点。' });
    await push();
    await wait("document.body.innerText.includes('已深度思考')");
    await wait(
      "[...document.querySelectorAll('[data-reasoning-body]')].every(el => el.parentElement.getBoundingClientRect().height < 1)",
    );
    await evaluate(
      "[...document.querySelectorAll('button')].find(b => b.textContent.includes('已深度思考')).click()",
    );
    await wait(
      "[...document.querySelectorAll('[data-reasoning-body]')].some(el => el.textContent.includes('先分析请求') && el.parentElement.getBoundingClientRect().height > 1)",
    );
    // 消息头运行态是静态“正在工作”，不携带每秒跳动的秒数。
    assert.match(
      await evaluate(
        "[...document.querySelectorAll('span')].find(el => el.textContent.trim() === '正在工作')?.textContent ?? ''",
      ),
      /^正在工作$/,
    );
    chat.activeTool = 'search_sources';
    // 工具开始即写入无输出的占位步骤（带输入摘要）；运行中的组自动展开。
    reply.parts.push({
      type: 'tools',
      results: [
        { id: 'run1', name: 'search_sources', input: { query: '本周课程' }, startedAt: Date.now() },
      ],
    });
    await push();
    await wait("document.body.innerText.includes('正在查找资料')");
    await wait(
      "[...document.querySelectorAll('span')].some(el => el.textContent === '「本周课程」' && el.checkVisibility())",
    );
    const first = {
      id: 'run1',
      name: 'search_sources',
      input: { query: '本周课程' },
      output: { ok: true, result: { count: 3 } },
    };
    reply.parts.at(-1).results[0] = first;
    reply.toolResults.push(first);
    chat.activeTool = undefined;
    await push();
    // 完成态摘要是去重的动作类别，没有计数；未触碰的组自动收起。
    await wait(
      "[...document.querySelectorAll('ol[aria-label=动作时间线]')].every(ol => ol.parentElement.getBoundingClientRect().height < 1)",
    );
    assert.ok(await evaluate("document.body.innerText.includes('查找资料')"));
    assert.ok(!(await evaluate("document.body.innerText.includes('个动作')")));
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
    chat.running = false;
    reply.finishedAt = reply.startedAt + 12400;
    await push();
    await new Promise((r) => setTimeout(r, 150));
    // 完成折叠工作过程后视口仍贴底：折叠收缩超过滚动偏移时 scrollTop 会被钳到 0
    // 并由 spacer 回填，位置数值相等不再是判据。
    assert.ok(
      await evaluate(
        `${viewport}.scrollHeight - ${viewport}.scrollTop - ${viewport}.clientHeight < 30`,
      ),
      'completion lost the bottom',
    );
    // 完成后整段工作过程折叠为一行“已工作 · X 秒 · N 个失败”（Codex 式），最终回答保持在下方。
    const body = await evaluate('document.body.innerText');
    assert.ok(body.indexOf('我会先') < body.indexOf('已保存复习计划'));
    await wait(
      "[...document.querySelectorAll('button')].some(b => b.textContent.includes('已工作 · 12 秒 · 1 个失败'))",
    );
    await wait(
      "[...document.querySelectorAll('[data-worked-body]')].every(el => el.getBoundingClientRect().height < 1)",
    );
    assert.ok(!body.includes('▍'));
    // 点击摘要行展开完整时间线，再进入单个动作组的详情；组摘要为类别文字。
    await evaluate(
      "[...document.querySelectorAll('button')].find(b => b.textContent.includes('已工作 · 12 秒')).click()",
    );
    await wait(
      "[...document.querySelectorAll('[data-worked-body]')].some(el => el.getBoundingClientRect().height > 1)",
    );
    assert.ok(await evaluate("document.body.innerText.includes('保存笔记、读取资料')"));
    await evaluate(
      "[...document.querySelectorAll('button')].find(b => b.textContent.includes('保存笔记、读取资料')).click()",
    );
    await wait("document.body.innerText.includes('资料尚未下载')");
    await evaluate(
      "[...document.querySelectorAll('button')].find(b => b.textContent.trim().startsWith('读取资料')).click()",
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
    // Long stream: auto-follow keeps the newest output at the bottom; scrolling away parks
    // the reading position; the back-to-bottom button resumes following.
    chat.running = true;
    delete reply.finishedAt;
    reply.parts.at(-1).text += '\n\n' + '长回答段落，用于验证阅读位置。\n\n'.repeat(60);
    await push();
    await new Promise((r) => setTimeout(r, 150));
    assert.ok(
      await evaluate(
        `${viewport}.scrollHeight - ${viewport}.scrollTop - ${viewport}.clientHeight < 30`,
      ),
      'long stream did not auto-follow',
    );
    await evaluate(
      `${viewport}.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true })); ${viewport}.scrollTop = 100`,
    );
    reply.parts.at(-1).text += '\n\n更多输出。'.repeat(20);
    await push();
    assert.equal(await evaluate(`${viewport}.scrollTop`), 100);
    await wait("document.querySelector('[aria-label=回到底部]')");
    await evaluate("document.querySelector('[aria-label=回到底部]').click()");
    await new Promise((r) => setTimeout(r, 700));
    reply.parts.at(-1).text += '\n\n后续输出。'.repeat(20);
    await push();
    assert.ok(
      await evaluate(
        `${viewport}.scrollHeight - ${viewport}.scrollTop - ${viewport}.clientHeight < 30`,
      ),
      'button follow lost track',
    );
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
    // Draft persistence: CM6 输入经 localStorage 按 scope 持久化，切页往返不丢失。
    win.setSize(1200, 900);
    await pause();
    const draftText = '草稿保留验证';
    await evaluate(editComposer(draftText));
    assert.ok(
      ((await evaluate('localStorage.getItem("dela.chat.drafts")')) ?? '').includes(draftText),
      'draft not written to localStorage',
    );
    const composerText = () =>
      evaluate(
        'document.querySelector(\'.cm-content[aria-label="发送给助手"]\')?.textContent ?? ""',
      );
    assert.ok(((await composerText()) || '').includes(draftText));
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
      await composerText(),
      draftText,
      'projects view shares the home composer draft',
    );
    assert.equal(await clickNav('首页'), 'clicked', 'home nav missing');
    await wait('document.querySelector(\'.cm-content[aria-label="发送给助手"]\') !== null');
    assert.ok(
      ((await composerText()) || '').includes(draftText),
      'draft lost after switching away and back',
    );
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log(
      'Chat smoke passed: composer menus and effort control, reasoning collapse, placeholder steps, category summaries, worked block, streaming Markdown, failures, disclosures, stable scroll, follow/escape, legacy sessions, draft persistence, 3 widths, light/dark.',
    );
    win.destroy();
    app.exit(0);
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
