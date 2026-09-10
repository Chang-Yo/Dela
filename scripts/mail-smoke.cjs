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
  seen: true,
  flagged: false,
  hasAttachments: false,
  snippet: '脱敏测试',
  size: 100,
  to: [{ name: '收件人', address: 'reader@example.com' }],
  cc: [],
  bodyHtml: html,
  bodyText: '富文本样例\n表格甲 表格乙',
  attachments: [],
});
const state = {
  account: { address: 'reader@example.com', lastSyncedAt: null },
  sync: { phase: 'idle', error: null, processed: 0, total: null },
};
const routes = {
  'window:get-state': () => ({ maximized: false }),
  'mail:get-state': () => state,
  'mail:list-folders': () => folders,
  'mail:list-messages': () => [message(1), message(2)],
  'mail:get-message': async (_, id) => {
    await new Promise((r) => setTimeout(r, id === 1 ? 180 : 10));
    return message(id);
  },
  'mail:sync': () => {},
  'mail:mark-seen': () => ({ ok: true }),
  'mail:open-link': () => {},
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
    const helper = stripTypeScriptTypes(
      readFileSync(join(root, 'src/renderer/features/mail/mail-html.ts'), 'utf8'),
    ).replaceAll('export function', 'function');
    const checked = await js(
      `(()=>{${helper}; const input=${JSON.stringify(html)};const output=prepareMailHtml(input,false); const d=new DOMParser().parseFromString(output,'text/html');return {styles:d.querySelectorAll('style').length,script:!!d.querySelector('script'),events:!!d.querySelector('[onerror]'),csp:d.querySelector('meta[http-equiv]').content,links:mailLinks(input).length};})()`,
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
    await js(
      `Array.from(document.querySelectorAll('button')).find(e=>e.textContent.includes('HTML 阅读验证 1')).click();Array.from(document.querySelectorAll('button')).find(e=>e.textContent.includes('HTML 阅读验证 2')).click()`,
    );
    await pause(350);
    assert.equal(await js(`document.querySelector('article h2').textContent`), 'HTML 阅读验证 2');
    const frame = win.webContents.mainFrame.frames.find((f) => f.url === 'about:srcdoc');
    assert(frame);
    await assert.rejects(frame.executeJavaScript('1+1'));
    assert.equal(await js(`document.querySelector('iframe').sandbox.length`), 0);
    writeFileSync(
      join(root, '.tools/mail-wide.png'),
      (await win.webContents.capturePage()).toPNG(),
    );
    win.setSize(660, 760);
    await pause(250);
    const narrow = await js(
      `(()=>{const e=document.querySelector('#mail-folders button span:nth-child(2)');return {name:getComputedStyle(e).display,overflow:document.documentElement.scrollWidth>innerWidth};})()`,
    );
    assert.notEqual(narrow.name, 'none');
    assert.equal(narrow.overflow, false);
    await js(
      `Array.from(document.querySelectorAll('button')).find(e=>e.textContent.includes('HTML 阅读验证 2')).click()`,
    );
    await pause(200);
    writeFileSync(
      join(root, '.tools/mail-narrow.png'),
      (await win.webContents.capturePage()).toPNG(),
    );
    console.log(
      'Mail QA passed: HTML styles/CSP, links, stable sidebar icons, request race, narrow layout.',
    );
    win.destroy();
    app.quit();
  })
  .catch((e) => {
    console.error(e);
    app.exit(1);
  });
