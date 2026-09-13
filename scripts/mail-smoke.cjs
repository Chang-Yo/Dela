const { app, BrowserWindow, ipcMain } = require('electron');
const { join } = require('node:path');
const { writeFileSync, readFileSync } = require('node:fs');
const { stripTypeScriptTypes } = require('node:module');
const assert = require('node:assert/strict');
const root = process.cwd();
app.setPath('userData', join(root, '.tools/mail-qa-profile'));
const folders = [
  { id: 1, name: '收件箱', specialUse: '\\Inbox', unread: 3 },
  { id: 2, name: '归档', specialUse: '\\Archive', unread: 0 },
];
const html =
  '<!doctype html><html><head><style>.brand{color:rgb(128,0,64)}@media(max-width:700px){.brand{font-weight:700}}</style></head><body><h1 class="brand">富文本样例</h1><table width="900" border="1"><tr><td>表格甲</td><td>表格乙</td></tr></table><blockquote>引用内容</blockquote><img alt="内嵌图片" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"><a href="https://example.com/">查看详情</a><script>window.mailScriptRan=true</script><img src="https://example.com/track" onerror="window.mailScriptRan=true"></body></html>';
const message = (id) => ({
  id,
  uid: id,
  subject: 'HTML 阅读验证 ' + id,
  sender: { name: '测试发件人', address: 'test@example.com' },
  date: '2026-09-10T01:00:00Z',
  seen: id !== 1,
  flagged: false,
  hasAttachments: id === 1,
  snippet: '脱敏测试',
  size: 100,
  to: [{ name: '收件人', address: 'reader@example.com' }],
  cc: [],
  bodyHtml: html,
  bodyText: '富文本样例\n表格甲 表格乙',
  attachments: id === 1 ? [{ filename: '附件.txt', size: 8, part: '2' }] : [],
});
const state = {
  account: { address: 'reader@example.com', lastSyncedAt: null },
  sync: { phase: 'idle', error: null, processed: 0, total: null },
};
let downloadCount = 0;
const routes = {
  'workspace:get-state': () => ({ entries: [], views: {}, directory: '' }),
  'canvas:get-state': () => ({ connected: false, courses: [], items: [], syncedAt: null }),
  'window:get-state': () => ({ maximized: false }),
  'mail:get-state': () => state,
  'mail:list-folders': () => folders,
  'mail:list-messages': () => [message(1), message(2)],
  'mail:get-message': async (_, id) => {
    await new Promise((r) => setTimeout(r, id === 1 ? 180 : 10));
    return message(id);
  },
  'mail:sync': (event) => {
    event.sender.send('mail:sync-status', {
      phase: 'connecting',
      folderPath: null,
      processed: 0,
      total: null,
      error: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
    });
    setTimeout(
      () =>
        event.sender.send('mail:sync-status', {
          phase: 'idle',
          folderPath: null,
          processed: 0,
          total: null,
          error: null,
          startedAt: null,
          finishedAt: new Date().toISOString(),
        }),
      80,
    );
  },
  'mail:mark-seen': () => ({ ok: true }),
  // 本地回收站与保留期：主进程逻辑不在此脱敏桩内运行，只提供默认响应。
  'mail:delete-message': () => ({ ok: true }),
  'mail:restore-message': () => ({ ok: true }),
  'mail:purge-message': () => ({ ok: true }),
  'mail:empty-trash': () => ({ ok: true }),
  'mail:list-trash': () => [],
  'mail:get-trash-retention': () => 30,
  'mail:set-trash-retention': () => 30,
  'mail:download-attachment': () => {
    downloadCount += 1;
    return { ok: true };
  },
  'mail:pick-compose-files': () => [],
  'mail:add-compose-image': () => ({
    id: '11111111-1111-4111-8111-111111111111',
    name: 'clipboard-image.png',
    size: 68,
    kind: 'inline',
    previewUrl:
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL6xQAAAABJRU5ErkJggg==',
  }),
  'mail:release-compose-files': () => {},
  'mail:send-message': () => ({ ok: true }),
  'mail:open-link': () => {},
  // 本地草稿通道：脱敏桩不落盘，确认对话框映射回页面的 window.confirm，
  // 与既有断言（confirm=false 留在编辑器、confirm=true 保存后关闭）语义一致。
  'mail:compose-active': () => null,
  'mail:confirm-draft-close': async (event) =>
    (await event.sender.executeJavaScript('window.confirm("是否保存这封邮件为本地草稿？")'))
      ? 'save'
      : 'cancel',
  'mail:save-draft': () => ({ id: 'smoke-draft-1' }),
  'mail:list-drafts': () => [],
  'mail:open-draft': () => {
    throw new Error('smoke 不覆盖 open-draft');
  },
  'mail:delete-draft': () => null,
};
for (const [channel, handler] of Object.entries(routes)) ipcMain.handle(channel, handler);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
app
  .whenReady()
  .then(async () => {
    const win = new BrowserWindow({
      show: false,
      width: 1280,
      height: 900,
      webPreferences: {
        offscreen: true,
        backgroundThrottling: false,
        preload: join(root, 'out/preload/index.cjs'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });
    win.webContents.session.webRequest.onBeforeRequest(
      { urls: ['https://example.com/*'] },
      (_, cb) => cb({ cancel: true }),
    );
    await win.loadFile(join(root, 'out/renderer/index.html'));
    await pause(300);
    const js = async (s) => {
      try {
        return await win.webContents.executeJavaScript(s);
      } catch (e) {
        console.error('Failed expression', s.slice(0, 180));
        throw e;
      }
    };
    win.webContents.on('console-message', (event) => console.log(event.message));
    const helper = [
      'src/renderer/features/mail/mail-html.ts',
      'src/renderer/features/mail/mail-html-display.ts',
    ]
      .map((path) => stripTypeScriptTypes(readFileSync(join(root, path), 'utf8')))
      .join('\n')
      .replaceAll('export function', 'function');
    const checked = await js(
      `(()=>{${helper}; const input=${JSON.stringify(html)};const output=renderMailHtml(sanitizeMailHtml(input,false),true); const d=new DOMParser().parseFromString(output,'text/html');return {styles:d.querySelectorAll('style').length,script:!!d.querySelector('script'),events:!!d.querySelector('[onerror]'),csp:d.querySelector('meta[http-equiv]').content,links:d.querySelectorAll('a[href]').length};})()`,
    );
    assert.equal(checked.styles, 3);
    assert.equal(checked.script, false);
    assert.equal(checked.events, false);
    assert.equal(checked.links, 1);
    assert(!checked.csp.includes('https:'));
    await js(
      `Array.from(document.querySelectorAll('nav button')).find(e=>e.textContent.includes('邮箱') || e.getAttribute('aria-label')==='邮箱').click()`,
    );
    await pause(1200);
    await js(`document.querySelector('[aria-label="同步邮件"]').click()`);
    await pause(20);
    assert.equal(
      await js(
        `document.querySelector('[aria-label="同步邮件"] svg').classList.contains('animate-spin')`,
      ),
      true,
    );
    await pause(120);
    assert.equal(
      await js(
        `document.querySelector('[aria-label="同步邮件"] svg').classList.contains('animate-spin')`,
      ),
      false,
    );
    const pos = () =>
      js(
        `(()=>{const e=document.querySelector('#mail-folders button svg').getBoundingClientRect(); return {x:e.x,y:e.y};})()`,
      );
    const first = await pos();
    await js(`document.querySelector('[aria-controls="mail-folders"]').click()`);
    await pause(220);
    assert.deepEqual(await pos(), first);
    await js(`document.querySelector('[aria-controls="mail-folders"]').click()`);
    await pause(220);
    assert.deepEqual(await pos(), first);
    await js(`document.querySelector('[aria-label="退出登录"]').click()`);
    await pause(50);
    assert.equal(
      await js(`document.querySelector('[aria-label="再点一次确认退出"]') !== null`),
      true,
    );
    await js(`document.querySelector('[aria-controls="mail-folders"]').click()`);
    await pause(50);
    assert.equal(await js(`document.querySelector('[aria-label="退出登录"]') !== null`), true);
    await js(`document.querySelector('[aria-label="发送邮件"]').click()`);
    await pause(100);
    assert.equal(await js(`document.querySelector('[aria-label="邮件正文"]') !== null`), true);
    await js(`document.querySelector('[aria-label="发送邮件"]').click()`);
    await pause(100);
    assert.equal(await js(`document.querySelector('[aria-label="邮件正文"]') === null`), true);
    await js(`document.querySelector('[aria-label="发送邮件"]').click()`);
    await pause(100);
    assert.equal(
      await js(`document.querySelector('button[type="submit"]').textContent.trim()`),
      '发送邮件',
    );
    await js(
      `(()=>{const data=new DataTransfer();data.items.add(new File([Uint8Array.of(137,80,78,71)],'paste.png',{type:'image/png'}));document.querySelector('[aria-label="邮件正文"]').dispatchEvent(new ClipboardEvent('paste',{bubbles:true,clipboardData:data}))})()`,
    );
    await pause(150);
    assert.equal(
      await js(`document.querySelector('[aria-label="邮件正文"] img[data-dela-inline]') !== null`),
      true,
    );
    await js(
      `(()=>{const editor=document.querySelector('[aria-label="邮件正文"]');editor.innerText='待发送正文';const range=document.createRange();range.selectNodeContents(editor);getSelection().removeAllRanges();getSelection().addRange(range);editor.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText'}));editor.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}))})()`,
    );
    await pause(50);
    await js(`document.querySelector('[aria-label="发送邮件"]').click()`);
    await pause(100);
    assert.equal(await js(`document.querySelector('[aria-label="邮件正文"]') !== null`), true);
    await js(
      `document.querySelector('[aria-label="加粗"]').click();window.confirm=()=>false;document.querySelector('[aria-label="关闭写邮件"]').click()`,
    );
    await pause(100);
    assert.equal(await js(`document.querySelector('[aria-label="邮件正文"]') !== null`), true);
    assert.equal(await js(`document.querySelector('[aria-label="邮件正文"] b') !== null`), true);
    await js(`window.confirm=()=>true;document.querySelector('[aria-label="关闭写邮件"]').click()`);
    await pause(100);
    assert.equal(await js(`document.querySelector('[aria-label="邮件正文"]') === null`), true);
    await js(
      `Array.from(document.querySelectorAll('button')).find(e=>e.textContent.includes('HTML 阅读验证 1')).click()`,
    );
    await pause(300);
    assert(
      await js(
        `document.querySelector('nav[aria-label="邮件文件夹"] button[aria-label="收件箱，2 封未读"]') !== null`,
      ),
      'opening an unread message should update the folder count immediately',
    );
    await js(`document.querySelector('[title="保存 附件.txt"]').click()`);
    await pause(50);
    assert.equal(downloadCount, 1);
    await js(
      `Array.from(document.querySelectorAll('button')).find(e=>e.textContent.includes('HTML 阅读验证 1')).click();Array.from(document.querySelectorAll('button')).find(e=>e.textContent.includes('HTML 阅读验证 2')).click()`,
    );
    await pause(350);
    assert.equal(await js(`document.querySelector('article h2').textContent`), 'HTML 阅读验证 2');
    const frame = win.webContents.mainFrame.frames.find((f) => f.url === 'about:srcdoc');
    assert(frame);
    await assert.rejects(frame.executeJavaScript('1+1'));
    assert.deepEqual(await js(`[...document.querySelector('iframe').sandbox]`), ['allow-popups']);
    writeFileSync(
      join(root, '.tools/mail-wide.png'),
      (await win.webContents.capturePage()).toPNG(),
    );
    win.setSize(660, 760);
    await pause(250);
    assert.equal(
      await js(`document.documentElement.scrollWidth > innerWidth`),
      false,
      'narrow list should not overflow',
    );
    assert.equal(
      await js(`document.querySelector('#mail-folders') !== null`),
      false,
      'narrow list should not reserve a folders column',
    );
    await js(
      `Array.from(document.querySelectorAll('button')).find(e=>e.textContent.includes('HTML 阅读验证 2')).click()`,
    );
    await pause(200);
    assert.equal(
      await js(
        `[...document.querySelectorAll('main section')].some(s=>s.querySelector('article')&&getComputedStyle(s).display!=='none')`,
      ),
      true,
      'narrow reading should swap the list for the reader',
    );
    assert.equal(
      await js(
        `[...document.querySelectorAll('main section')].every(s=>!s.querySelector("input[aria-label='搜索邮件']")||getComputedStyle(s).display==='none')`,
      ),
      true,
      'narrow reading should hide the message list',
    );
    writeFileSync(
      join(root, '.tools/mail-narrow.png'),
      (await win.webContents.capturePage()).toPNG(),
    );
    await js(`document.querySelector('[aria-label="展开侧边栏"]').click()`);
    await pause(250);
    assert.equal(
      await js(
        `(()=>{const nav=document.querySelector('#mail-drawer-slot nav[aria-label="邮件文件夹"]');const name=nav&&nav.querySelector('button span');return name!==null&&getComputedStyle(name).display!=='none';})()`,
      ),
      true,
      'mail drawer should list named folders',
    );
    assert.equal(
      await js(`document.querySelector('#mail-drawer-slot [aria-label="退出登录"]') !== null`),
      true,
      'mail drawer should keep account actions reachable',
    );
    await js(`document.querySelector('[aria-label="返回主菜单"]').click()`);
    await pause(200);
    assert.equal(await js(`document.querySelector('#mail-drawer-slot nav') !== null`), false);
    await js(
      `Array.from(document.querySelectorAll('#main-nav nav button')).find(e=>e.textContent.includes('邮箱')).click()`,
    );
    await pause(200);
    assert.equal(
      await js(`document.querySelector('#mail-drawer-slot [aria-label="发送邮件"]') !== null`),
      true,
      'nav should drill back into the mail drawer',
    );
    await js(`document.querySelector('#mail-drawer-slot [aria-label="发送邮件"]').click()`);
    await pause(100);
    assert.equal(
      await js(`document.documentElement.scrollWidth > innerWidth`),
      false,
      'narrow composer should not overflow',
    );
    const composerLayout = await js(
      `(()=>{const editor=document.querySelector('[aria-label="邮件正文"]');const form=editor.closest('form');const grid=form.parentElement;return {editor:editor.getBoundingClientRect().width,form:form.getBoundingClientRect().width,grid:getComputedStyle(grid).gridTemplateColumns,viewport:innerWidth}})()`,
    );
    assert(
      composerLayout.editor > 300,
      `narrow composer should use the available content width: ${JSON.stringify(composerLayout)}`,
    );
    win.setSize(1280, 900);
    await pause(200);
    await js(
      `const editor=document.querySelector('[aria-label="邮件正文"]');editor.innerHTML='未发送的验证草稿';editor.dispatchEvent(new Event('input',{bubbles:true}));`,
    );
    await pause(50);
    await js(
      `window.leaveConfirmCount=0;window.confirm=()=>{window.leaveConfirmCount++;return true;};document.querySelector('[aria-label="新建项目"]').click();`,
    );
    await pause(500);
    assert.equal(
      await js('window.leaveConfirmCount'),
      1,
      'opening a new project must ask to leave mail only once',
    );
    assert.equal(await js(`document.querySelector('[role="dialog"] h2')?.textContent`), '新建项目');
    console.log(
      'Mail QA passed: HTML styles/CSP, links, stable sidebar icons, request race, narrow layout, and one confirmation when leaving for a new project.',
    );
    win.destroy();
    app.quit();
  })
  .catch((e) => {
    console.error(e);
    app.exit(1);
  });
