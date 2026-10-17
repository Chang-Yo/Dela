// 真实应用、独立用户目录：验证标题栏 → Terminal → 多个 PTY 会话。
const { app } = require('electron');
const { dirname, join, resolve } = require('node:path');
const { mkdtempSync, writeFileSync } = require('node:fs');
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
process.argv.push('--terminal-smoke-test');

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

async function run(window) {
  const js = (source) =>
    window.webContents.executeJavaScript(source).catch((error) => {
      console.error('Failed fixture action:', source);
      throw error;
    });
  const wait = async (source, label) => {
    const until = Date.now() + 10000;
    while (Date.now() < until) {
      if (await js(source)) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    console.error(
      await js(
        `({ alerts: [...document.querySelectorAll('[role="alert"]')].map(e => e.textContent), copyDisabled: document.querySelector('button[aria-label="复制终端选区"]')?.disabled, selectionLayer: document.querySelectorAll('.xterm-selection > div').length, copied: window.terminalCopiedText ?? null })`,
      ),
    );
    if (globalThis.terminalProjectId)
      console.error(
        await js(
          `window.dela.terminal.list('${globalThis.terminalProjectId}').then(items => items.map(({id,sequence,exitCode}) => ({id,sequence,exitCode})))`,
        ),
      );
    throw new Error(`Timed out: ${label}`);
  };
  const project = await js(
    `window.dela.workspace.create({ parentId: null, name: '终端 ; & 中文', kind: 'project' })`,
  );
  globalThis.terminalProjectId = project.id;
  await new Promise((resolve) => {
    window.webContents.once('did-finish-load', resolve);
    window.reload();
  });
  await wait(`!!document.querySelector('button[title="终端 ; & 中文"]')`, 'project navigation');
  // 项目名现在只展开会话；打开工作台走项目菜单。
  await js(
    `document.querySelector('button[aria-label="终端 ; & 中文 的项目菜单"]').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }))`,
  );
  await wait(
    `[...document.querySelectorAll('[role="menuitem"]')].some(item => item.textContent.trim() === '打开项目')`,
    'open project menu',
  );
  await js(
    `[...document.querySelectorAll('[role="menuitem"]')].find(item => item.textContent.trim() === '打开项目').click()`,
  );
  await wait(
    `!!document.querySelector('button[aria-label="打开项目终端"]')`,
    'titlebar terminal button',
  );
  await js(`document.querySelector('button[aria-label="打开项目终端"]').click()`);
  await wait(
    `!!document.querySelector('[data-tab="terminal:${project.id}"]') && !!document.querySelector('.xterm-helper-textarea')`,
    'Terminal tab and xterm',
  );
  const list = () => js(`window.dela.terminal.list('${project.id}')`);
  await wait(
    `window.dela.terminal.list('${project.id}').then(items => items.length === 1 && /\\$\\s*$|MINGW64/.test(items[0].buffer))`,
    'Bash prompt ready',
  );
  const first = (await list())[0];
  // dela 命令桥经 --rcfile 注入：type 应识别为函数。
  await js(
    `window.dela.terminal.write('${first.id}', ${JSON.stringify('type dela >/dev/null && echo DELA_BRIDGE_OK\r')})`,
  );
  await wait(
    `window.dela.terminal.list('${project.id}').then(items => items[0].buffer.includes('DELA_BRIDGE_OK'))`,
    'dela bridge function injected',
  );
  await js(`document.querySelector('.xterm-helper-textarea').focus()`);
  for (const keyCode of 'echo DELA_INPUT')
    window.webContents.sendInputEvent({ type: 'char', keyCode });
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
  await wait(
    `window.dela.terminal.list('${project.id}').then(items => items[0].buffer.includes('DELA_INPUT'))`,
    'xterm keyboard input / PTY output',
  );
  for (const keyCode of 'echo DELA_EDITX')
    window.webContents.sendInputEvent({ type: 'char', keyCode });
  for (const keyCode of ['Left', 'Delete', 'Enter']) {
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode });
  }
  await wait(
    `window.dela.terminal.list('${project.id}').then(items => items[0].buffer.includes('DELA_EDIT\\r\\n'))`,
    'readline cursor movement and editing',
  );
  if (process.platform === 'darwin') {
    await js(
      `window.dela.terminal.write('${first.id}', "printf 'INTERRUPT_READY\\n'; sleep 30\\r")`,
    );
    await wait(
      `window.dela.terminal.list('${project.id}').then(items => items[0].buffer.includes('INTERRUPT_READY\\r\\n'))`,
      'interrupt target running',
    );
    for (const type of ['keyDown', 'keyUp'])
      window.webContents.sendInputEvent({ type, keyCode: 'c', modifiers: ['control'] });
    await js(`window.dela.terminal.write('${first.id}', "echo INTERRUPT_OK\\r")`);
    await wait(
      `window.dela.terminal.list('${project.id}').then(items => items[0].buffer.includes('INTERRUPT_OK\\r\\n'))`,
      'Control+C still interrupts Bash',
    );
  }
  // 隔离剪贴板夹具，不改写真实系统剪贴板。
  await js(`Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
    readText: async () => "echo DELA_PASTE",
    writeText: async (text) => { window.terminalCopiedText = text; }
  } })`);
  await js(`document.querySelector('button[aria-label="粘贴到终端"]').click()`);
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
  await wait(
    `window.dela.terminal.list('${project.id}').then(items => items[0].buffer.includes('DELA_PASTE'))`,
    'paste button',
  );
  if (process.platform === 'darwin') {
    await js(
      `navigator.clipboard.readText = async () => 'echo COMMAND_PASTE'; document.querySelector('.xterm-helper-textarea').focus()`,
    );
    for (const type of ['keyDown', 'keyUp'])
      window.webContents.sendInputEvent({ type, keyCode: 'v', modifiers: ['meta'] });
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
    await wait(
      `window.dela.terminal.list('${project.id}').then(items => items[0].buffer.includes('COMMAND_PASTE\\r\\n'))`,
      'Command+V pastes into Bash',
    );
  }
  // 拖选锚定最后一个非空白 span 的精确矩形：bash 的 PS1 带空行与换行，整行锚定会漂到空白行。
  const selectionBox = await js(`(() => {
    const span = [...document.querySelectorAll('.xterm-rows span')]
      .filter(span => span.textContent.trim().length > 0)
      .pop();
    const row = span.closest('.xterm-rows > div').getBoundingClientRect();
    const rect = span.getBoundingClientRect();
    return {
      x1: Math.round(rect.left + 1),
      x2: Math.round(rect.right - 1),
      y: Math.round(row.top + row.height / 2),
    };
  })()`);
  window.webContents.sendInputEvent({
    type: 'mouseDown',
    button: 'left',
    clickCount: 1,
    x: selectionBox.x1,
    y: selectionBox.y,
  });
  window.webContents.sendInputEvent({
    type: 'mouseMove',
    x: selectionBox.x2,
    y: selectionBox.y,
    button: 'left',
  });
  window.webContents.sendInputEvent({
    type: 'mouseUp',
    x: selectionBox.x2,
    y: selectionBox.y,
    button: 'left',
    clickCount: 1,
  });
  await wait(
    `!document.querySelector('button[aria-label="复制终端选区"]').disabled`,
    'mouse drag selection',
  );
  await js(`document.querySelector('button[aria-label="复制终端选区"]').click()`);
  await wait(
    `typeof window.terminalCopiedText === 'string' && window.terminalCopiedText.length > 0`,
    'copy selected text',
  );
  if (process.platform === 'darwin') {
    await js("window.terminalCopiedText = ''");
    for (const type of ['keyDown', 'keyUp'])
      window.webContents.sendInputEvent({ type, keyCode: 'c', modifiers: ['meta'] });
    await wait('window.terminalCopiedText.length > 0', 'Command+C copies terminal selection');
  }
  await js(`window.terminalCopiedText = ''`);
  window.webContents.sendInputEvent({
    type: 'mouseDown',
    button: 'right',
    clickCount: 1,
    x: selectionBox.x1,
    y: selectionBox.y,
  });
  window.webContents.sendInputEvent({
    type: 'mouseUp',
    button: 'right',
    clickCount: 1,
    x: selectionBox.x1,
    y: selectionBox.y,
  });
  await wait(`window.terminalCopiedText.length > 0`, 'right-click copies terminal selection');
  await js(`document.querySelector('.xterm-helper-textarea').focus()`);
  for (const keyCode of 'echo DELA_MOUSEX')
    window.webContents.sendInputEvent({ type: 'char', keyCode });
  await wait(
    `[...document.querySelectorAll('.xterm-rows span')].some(span => span.textContent.includes('MOUSEX'))`,
    'mouse editing target',
  );
  const mouseTarget = await js(`(() => {
    const span = [...document.querySelectorAll('.xterm-rows span')].find(span => span.textContent.includes('MOUSEX'));
    const rect = span.getBoundingClientRect();
    const width = rect.width / span.textContent.length;
    return { x: Math.round(rect.left + (span.textContent.indexOf('MOUSEX') + 6.25) * width), y: Math.round(rect.top + rect.height / 2) };
  })()`);
  window.webContents.sendInputEvent({
    type: 'mouseDown',
    button: 'left',
    clickCount: 1,
    modifiers: ['alt'],
    ...mouseTarget,
  });
  window.webContents.sendInputEvent({
    type: 'mouseUp',
    button: 'left',
    clickCount: 1,
    modifiers: ['alt'],
    ...mouseTarget,
  });
  for (const keyCode of ['Backspace', 'Enter']) {
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode });
  }
  await wait(
    `window.dela.terminal.list('${project.id}').then(items => items[0].buffer.includes('DELA_MOUSE\\r\\n'))`,
    'Alt-click prompt cursor movement',
  );
  await js(`document.querySelector('button[aria-label="新建终端"]').click()`);
  await wait(
    `window.dela.terminal.list('${project.id}').then(items => items.length === 2)`,
    'second session',
  );
  await wait(
    `document.querySelectorAll('[aria-label="终端会话"] [role="tab"]').length === 2`,
    'session tabs',
  );
  const second = (await list()).find((item) => item.id !== first.id);
  await js(
    `window.dela.terminal.write('${second.id}', ${JSON.stringify('echo DELA_SECOND; pwd\r')})`,
  );
  await wait(
    `window.dela.terminal.list('${project.id}').then(items => items.find(i => i.id === '${second.id}').buffer.includes('DELA_SECOND'))`,
    'second shell output',
  );
  assert.ok((await list()).find((item) => item.id === second.id).buffer.includes('终端 ; & 中文'));
  await js(`document.querySelectorAll('[aria-label="终端会话"] [role="tab"]')[0].click()`);
  await wait(
    `document.querySelectorAll('[aria-label="终端会话"] [role="tab"]')[0].getAttribute('aria-selected') === 'true'`,
    'switch session',
  );
  // 切到另一个工作台标签再回来，进程身份与输出均应保留。
  await js(`document.querySelector('button[aria-label="在 终端 ; & 中文 中新建对话"]').click()`);
  await wait(`!!document.querySelector('[role="tab"][data-tab^="chat:"]')`, 'chat tab');
  await js(`document.querySelector('[role="tab"][data-tab^="chat:"]').click()`);
  await wait(`!document.querySelector('.xterm')`, 'switch away');
  await js(`document.querySelector('[data-tab="terminal:${project.id}"]').click()`);
  await wait(`!!document.querySelector('.xterm-helper-textarea')`, 'remount terminal');
  assert.deepEqual(
    (await list()).map((item) => item.id),
    [first.id, second.id],
  );
  await js(
    `document.documentElement.classList.remove('light'); document.documentElement.classList.add('dark')`,
  );
  await wait(`document.documentElement.classList.contains('dark')`, 'dark theme');
  await new Promise((resolve) => setTimeout(resolve, 300));
  window.showInactive();
  await new Promise((resolve) => setTimeout(resolve, 300));
  const capture = await window.webContents.capturePage(undefined, {
    stayHidden: true,
    stayAwake: true,
  });
  writeFileSync(join(profile, 'terminal.png'), capture.toPNG());
  window.hide();
  await js(`document.querySelector('button[aria-label="关闭终端 2"]').click()`);
  await wait(
    `window.dela.terminal.list('${project.id}').then(items => items.length === 1)`,
    'close one session',
  );
  await js(`document.querySelector('[data-tab="terminal:${project.id}"] button').click()`);
  await wait(
    `window.dela.terminal.list('${project.id}').then(items => items.length === 0)`,
    'close Terminal tab',
  );
  console.log(
    `Terminal smoke passed: titlebar, xterm input, project cwd, multi-session, remount, theme, close cleanup. Screenshot: ${join(profile, 'terminal.png')}`,
  );
}
