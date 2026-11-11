// 真实应用、独立用户目录：标题栏 → Terminal → 真实 shell 的输入、剪贴板、多会话与回收。
const { app } = require('electron');
const { dirname, join, resolve } = require('node:path');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const assert = require('node:assert/strict');
const root = resolve(process.argv[2] || '.');
app.setAppPath(root);
if (root.endsWith('.asar')) {
  // 加载包内 main 时也按包内资源定位；脚本宿主仍为开发 Electron。
  Object.defineProperty(app, 'isPackaged', { value: true });
  process.resourcesPath = dirname(root);
}
const profile = mkdtempSync(join(tmpdir(), 'dela-terminal-smoke-'));
app.setPath('userData', profile);
app.setPath('documents', profile);
// PSReadLine 会按历史预测补全，历史放进临时目录，既不污染用户历史也不干扰断言。
if (process.platform === 'win32') process.env.APPDATA = profile;
process.argv.push('--terminal-smoke-test');

const PROJECT = '终端 ; & 中文';
const mac = process.platform === 'darwin';
const clipboardModifiers = mac ? ['meta'] : ['control', 'shift'];

app.once('browser-window-created', (_event, window) => {
  window.webContents.setBackgroundThrottling(false);
  window.webContents.once('did-finish-load', () => {
    void run(window)
      .then(() => app.quit())
      .catch((error) => {
        console.error(error);
        app.exit(1);
      });
  });
});
require(join(root, 'out/main/index.cjs'));

// 去掉控制序列后按行比较：输入回显带提示符、历史预测跟在已输入文本后，都不会独占一行。
// ConPTY 换行有时用光标定位而不是 \r\n，定位序列按换行处理。
const lines = (buffer) =>
  buffer
    // oxlint-disable-next-line no-control-regex -- 终端输出本身就是控制序列。
    .replace(/\x1b\[\d*(;\d*)?H/g, '\n')
    // oxlint-disable-next-line no-control-regex -- 同上。
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07|\x1b[=>]/g, '')
    .split(/\r?\n/)
    .map((line) => line.trim());

async function run(window) {
  const js = (source) => window.webContents.executeJavaScript(source);
  let projectId;
  const sessions = () => js(`window.dela.terminal.list('${projectId}')`);
  const wait = async (check, label) => {
    const until = Date.now() + 15000;
    while (Date.now() < until) {
      if (await check()) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (projectId) console.error((await sessions()).map((item) => lines(item.buffer).slice(-8)));
    throw new Error(`Timed out: ${label}`);
  };
  const waitDom = (source, label) => wait(() => js(source), label);
  const printed = (id, marker) =>
    wait(
      async () => lines((await sessions()).find((item) => item.id === id).buffer).includes(marker),
      `output ${marker}`,
    );
  // 标记之后重新出现提示符：shell 已回到可输入状态。
  const promptAfter = (id, marker) =>
    wait(async () => {
      const output = lines((await sessions()).find((item) => item.id === id).buffer);
      return output.slice(output.lastIndexOf(marker) + 1).some((line) => /[$%>#]$/.test(line));
    }, `prompt after ${marker}`);
  // 键盘事件只送到焦点元素；点过工具栏按钮后焦点会离开 xterm。
  const focus = () => js(`document.querySelector('.xterm-helper-textarea').focus()`);
  const press = async (keyCode, modifiers = []) => {
    await focus();
    for (const type of ['keyDown', 'keyUp'])
      window.webContents.sendInputEvent({ type, keyCode, modifiers });
  };
  const type = async (text) => {
    await focus();
    for (const keyCode of text) window.webContents.sendInputEvent({ type: 'char', keyCode });
  };

  projectId = (
    await js(
      `window.dela.workspace.create({ parentId: null, name: '${PROJECT}', kind: 'project' })`,
    )
  ).id;
  await new Promise((resolve) => {
    window.webContents.once('did-finish-load', resolve);
    window.reload();
  });
  await waitDom(
    `!!document.querySelector('button[aria-label="${PROJECT} 的项目菜单"]')`,
    'project navigation',
  );
  await js(
    `document.querySelector('button[aria-label="${PROJECT} 的项目菜单"]').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }))`,
  );
  await waitDom(
    `[...document.querySelectorAll('[role="menuitem"]')].some(item => item.textContent.trim() === '打开项目')`,
    'project menu',
  );
  await js(
    `[...document.querySelectorAll('[role="menuitem"]')].find(item => item.textContent.trim() === '打开项目').click()`,
  );
  await waitDom(`!!document.querySelector('button[aria-label="打开项目终端"]')`, 'titlebar button');
  await js(`document.querySelector('button[aria-label="打开项目终端"]').click()`);
  await waitDom(`!!document.querySelector('.xterm-helper-textarea')`, 'Terminal tab and xterm');
  await wait(async () => {
    const items = await sessions();
    return items.length === 1 && /[$%>#]$/.test(lines(items[0].buffer).filter(Boolean).at(-1));
  }, 'shell prompt');
  const [first] = await sessions();
  // 回归：pwsh 7 的模块路径漏给 5.1 时，PSReadLine 加载失败。
  assert.doesNotMatch(first.buffer, /Cannot load PSReadline/i);

  // 真实键盘输入 + 行编辑：方向键与删除键要按终端序列送到 shell。
  await type('echo DELA_EDITX');
  for (const keyCode of ['Left', 'Delete', 'Enter']) await press(keyCode);
  await printed(first.id, 'DELA_EDIT');

  // Control+C 不能被剪贴板快捷键吞掉。Windows 控制台中断时清空输入缓冲，
  // 必须等提示符回来再写下一条命令。
  await js(`window.dela.terminal.write('${first.id}', 'echo INTERRUPT_READY; sleep 30\\r')`);
  await printed(first.id, 'INTERRUPT_READY');
  await press('c', ['control']);
  await promptAfter(first.id, 'INTERRUPT_READY');
  await js(`window.dela.terminal.write('${first.id}', 'echo INTERRUPT_OK\\r')`);
  await printed(first.id, 'INTERRUPT_OK');

  // 隔离剪贴板夹具，不改写真实系统剪贴板。
  await js(`Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
    readText: async () => 'echo DELA_PASTE',
    writeText: async (text) => { window.terminalCopiedText = text; }
  } })`);
  await press('v', clipboardModifiers);
  await press('Enter');
  await printed(first.id, 'DELA_PASTE');

  // 拖选最后一个非空白 span，再分别用快捷键与右键复制。
  const box = await js(`(() => {
    const span = [...document.querySelectorAll('.xterm-rows span')]
      .filter(span => span.textContent.trim().length > 0)
      .pop();
    const row = span.closest('.xterm-rows > div').getBoundingClientRect();
    const rect = span.getBoundingClientRect();
    return { x1: Math.round(rect.left + 1), x2: Math.round(rect.right - 1), y: Math.round(row.top + row.height / 2) };
  })()`);
  for (const [type, x] of [
    ['mouseDown', box.x1],
    ['mouseMove', box.x2],
    ['mouseUp', box.x2],
  ])
    window.webContents.sendInputEvent({ type, button: 'left', clickCount: 1, x, y: box.y });
  await waitDom(
    `!document.querySelector('button[aria-label="复制终端选区"]').disabled`,
    'drag selection',
  );
  await js(`window.terminalCopiedText = ''`);
  await press('c', clipboardModifiers);
  await waitDom(`window.terminalCopiedText.length > 0`, 'shortcut copies selection');
  await js(`window.terminalCopiedText = ''`);
  for (const type of ['mouseDown', 'mouseUp'])
    window.webContents.sendInputEvent({
      type,
      button: 'right',
      clickCount: 1,
      x: box.x1,
      y: box.y,
    });
  await waitDom(`window.terminalCopiedText.length > 0`, 'right-click copies selection');

  // 第二个会话在项目目录启动，特殊字符路径不被 shell 拆开。
  await js(`document.querySelector('button[aria-label="新建终端"]').click()`);
  await wait(async () => (await sessions()).length === 2, 'second session');
  const second = (await sessions()).find((item) => item.id !== first.id);
  await js(`window.dela.terminal.write('${second.id}', 'echo DELA_SECOND; pwd\\r')`);
  await printed(second.id, 'DELA_SECOND');
  await wait(
    async () => (await sessions()).find((item) => item.id === second.id).buffer.includes(PROJECT),
    'project cwd',
  );

  // 切到另一个工作台标签再回来，进程与输出都保留。
  await js(`document.querySelector('button[aria-label="在 ${PROJECT} 中新建对话"]').click()`);
  await waitDom(`!!document.querySelector('[role="tab"][data-tab^="chat:"]')`, 'chat tab');
  await js(`document.querySelector('[role="tab"][data-tab^="chat:"]').click()`);
  await waitDom(`!document.querySelector('.xterm')`, 'switch away');
  await js(`document.querySelector('[data-tab="terminal:${projectId}"]').click()`);
  await waitDom(`!!document.querySelector('.xterm-helper-textarea')`, 'remount terminal');
  assert.deepEqual(
    (await sessions()).map((item) => item.id),
    [first.id, second.id],
  );

  await js(`document.querySelector('button[aria-label="关闭终端 2"]').click()`);
  await wait(async () => (await sessions()).length === 1, 'close one session');
  await js(`document.querySelector('[data-tab="terminal:${projectId}"] button').click()`);
  await wait(async () => (await sessions()).length === 0, 'close Terminal tab');
  console.log(
    'Terminal smoke passed: shell prompt, keyboard editing, Control+C, clipboard, project cwd, multi-session, remount, cleanup.',
  );
}
