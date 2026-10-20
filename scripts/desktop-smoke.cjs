// 独立 profile 检查真实主进程、原生菜单与可取消的退出，不访问真实账号或系统启动项。
const { app, BrowserWindow, dialog, Menu } = require('electron');
const { dirname, join, resolve } = require('node:path');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { constants, publicEncrypt, randomUUID } = require('node:crypto');
const assert = require('node:assert/strict');
const root = resolve(process.argv[2] || '.');
app.setAppPath(root);
const packaged = root.endsWith('.asar');
if (packaged) {
  Object.defineProperty(app, 'isPackaged', { value: true });
  process.resourcesPath = dirname(root);
}
const profile = mkdtempSync(join(tmpdir(), 'dela-desktop-smoke-'));
for (const name of ['userData', 'documents', 'home']) app.setPath(name, profile);
process.argv.push('--terminal-smoke-test');
app.setLoginItemSettings = () => {
  throw new Error('Smoke must not register login items');
};
let declined = 0;
dialog.showMessageBoxSync = () => {
  declined++;
  return 1;
};

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
      console.error('Failed desktop fixture:', source);
      throw error;
    });
  const wait = async (predicate, label) => {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      if (await predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Timed out: ${label}`);
  };
  await wait(() => js("!!document.querySelector('main')"), 'app mounted');
  assert.equal(await js('window.dela.platform'), process.platform);
  if (process.platform === 'darwin') {
    const bounds = window.getBounds();
    const zoom = window.webContents.getZoomFactor();
    const fontSize = await js('document.documentElement.style.fontSize');
    try {
      for (const width of [1100, 600]) {
        window.setSize(width, bounds.height);
        for (const [factor, font] of [
          [0.9, 12],
          [1, 16],
          [1.5, 20],
        ]) {
          window.webContents.setZoomFactor(factor);
          await js(`document.documentElement.style.fontSize = '${font}px'`);
          await wait(
            () => js(`Math.abs(innerWidth * ${factor} - ${width}) < 2`),
            'titlebar zoom and resize',
          );
          let layout;
          // 缩放后的 viewport 与原生覆盖区/CSS 环境变量分别更新，不能只等 innerWidth。
          await wait(async () => {
            layout = await js(`(() => {
            const header = document.querySelector('header');
            return {
              overlay: navigator.windowControlsOverlay.getTitlebarAreaRect().toJSON(),
              visible: navigator.windowControlsOverlay.visible,
              header: header.getBoundingClientRect().toJSON(),
              paddingLeft: getComputedStyle(header).paddingLeft,
              drag: getComputedStyle(header).getPropertyValue('-webkit-app-region'),
              buttons: [...header.querySelectorAll('button')].map(button => ({
                label: button.getAttribute('aria-label'),
                rect: button.getBoundingClientRect().toJSON(),
                drag: getComputedStyle(button).getPropertyValue('-webkit-app-region'),
              })),
            };
            })()`);
            return (
              Math.abs(parseFloat(layout.paddingLeft) - layout.overlay.x) < 1 &&
              Math.abs(layout.header.height - layout.overlay.height) < 1
            );
          }, 'titlebar overlay and CSS geometry').catch((error) => {
            console.error('Titlebar geometry did not settle:', { width, factor, font, layout });
            throw error;
          });
          assert.equal(layout.visible, true);
          assert.ok(layout.overlay.x > 0 && layout.overlay.height > 0);
          assert.equal(layout.header.top, 0);
          assert.ok(Math.abs(layout.header.height - layout.overlay.height) < 1);
          assert.equal(layout.drag, 'drag');
          for (const { rect, drag } of layout.buttons) {
            assert.ok(
              rect.left >= layout.overlay.x - 1,
              `导航覆盖原生窗口按钮: ${JSON.stringify({ width, factor, font, layout })}`,
            );
            assert.ok(rect.top >= -1 && rect.bottom <= layout.header.bottom + 1, '导航超出标题栏');
            assert.ok(rect.right <= layout.header.right + 1, '导航超出窗口');
            assert.equal(drag, 'no-drag');
          }
        }
      }
    } finally {
      window.setBounds(bounds);
      window.webContents.setZoomFactor(zoom);
      await js(`document.documentElement.style.fontSize = ${JSON.stringify(fontSize)}`);
    }
  }
  // 真正经 IPC 打开授权窗，只替换远端页面和验证响应，不使用真实账号。
  const loadURL = BrowserWindow.prototype.loadURL;
  const fetch = globalThis.fetch;
  let authorization;
  let encrypted;
  BrowserWindow.prototype.loadURL = function (url, options) {
    if (url.startsWith('https://shuiyuan.sjtu.edu.cn/user-api-key/new?')) {
      authorization = this;
      const params = new URL(url).searchParams;
      encrypted = publicEncrypt(
        { key: params.get('public_key'), padding: constants.RSA_PKCS1_PADDING },
        Buffer.from(JSON.stringify({ key: 'desktop-fixture', nonce: params.get('nonce') })),
      ).toString('base64');
      return loadURL.call(this, 'data:text/html,<title>Authorization fixture</title>', options);
    }
    return loadURL.call(this, url, options);
  };
  globalThis.fetch = async (url) => {
    assert.equal(url, 'https://shuiyuan.sjtu.edu.cn/session/current.json');
    return new Response(JSON.stringify({ current_user: { username: 'desktop-fixture' } }));
  };
  try {
    await js('window.dela.shuiyuan.startAuth()');
    const first = authorization;
    assert.ok(first);
    assert.equal(first.getParentWindow(), window);
    assert.equal(first.isModal(), process.platform !== 'darwin');
    if (process.platform === 'darwin') {
      assert.equal(window.isEnabled(), true);
      assert.ok(first.getBounds().height > first.getContentBounds().height, '缺少原生标题栏');
    }
    const preferences = first.webContents.getLastWebPreferences();
    assert.equal(preferences.contextIsolation, true);
    assert.equal(preferences.sandbox, true);
    assert.equal(preferences.nodeIntegration, false);
    assert.ok(!preferences.preload);
    await js('window.dela.shuiyuan.startAuth()');
    assert.equal(authorization, first);
    assert.equal(BrowserWindow.getAllWindows().length, 2);
    first.close();
    await wait(() => first.isDestroyed(), 'authorization closed');
    assert.equal(window.isEnabled(), true);
    const bound = await js(`window.dela.shuiyuan.bind(${JSON.stringify(encrypted)})`);
    assert.equal(bound.connected, true);
    assert.equal(bound.username, 'desktop-fixture');
  } finally {
    BrowserWindow.prototype.loadURL = loadURL;
    globalThis.fetch = fetch;
    if (authorization && !authorization.isDestroyed()) authorization.close();
  }
  if (process.platform === 'darwin') {
    // 更新平台门已与 Windows 一致放开；打包冒烟停在初始状态，不触发真实联网检查。
    const update = await js('window.dela.update.getState()');
    assert.equal(update.phase, 'idle');
    if (!packaged) {
      const checked = await js('window.dela.update.check()');
      assert.equal(checked.phase, 'unsupported');
      assert.equal(checked.reason, 'not-packaged');
      assert.deepEqual(await js('window.dela.update.getState()'), checked);
    }
    const workspace = await js('window.dela.workspace.getState()');
    const exportError = await js(
      "window.dela.workspace.exportOfficePdf({ type: 'canvas', id: 'file:smoke' }).then(() => '', error => error.message)",
    );
    assert.match(exportError, /当前平台暂不支持 PPTX 转 PDF/);
    assert.deepEqual(await js('window.dela.workspace.getState()'), workspace);
    assert.equal(
      await js('document.querySelector(\'header button[aria-label="关闭"]\') === null'),
      true,
    );
    const menu = Menu.getApplicationMenu();
    assert.ok(menu);
    const items = menu.items.flatMap((item) => item.submenu?.items ?? []);
    assert.ok(items.some((item) => item.role === 'quit'));
    assert.ok(items.some((item) => item.role === 'copy'));
    assert.ok(items.some((item) => item.role === 'paste'));
    const close = items.find((item) => item.label === '关闭窗口');
    assert.ok(close);
    assert.ok(!close.accelerator);
    window.show();
    close.click(close, undefined, {});
    assert.equal(window.isVisible(), true);
    const popup = new BrowserWindow({
      parent: window,
      modal: true,
      show: false,
      webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
    });
    await popup.loadURL('data:text/html,<title>Login window fixture</title>');
    popup.show();
    // Electron 把菜单触发时的窗口作为参数传入；使用真实弹窗，避免后台 CI 抢系统焦点。
    close.click(close, popup, {});
    await wait(() => popup.isDestroyed(), 'menu closes focused auxiliary window');
    assert.equal(window.isDestroyed(), false);
    assert.equal(window.isVisible(), true);
    close.click(close, window, {});
    assert.equal(window.isDestroyed(), false);
    assert.equal(window.isVisible(), false);
    const settings = items.find((item) => item.label === '设置…');
    settings.click(settings, window, {});
    await wait(() => js("!!document.querySelector('[data-setting-id]')"), 'native settings action');
  } else assert.equal(Menu.getApplicationMenu(), null);

  const project = await js(
    "window.dela.workspace.create({ parentId: null, name: '生命周期测试', kind: 'project' })",
  );
  const id = randomUUID();
  await js(`window.dela.terminal.create('${project.id}', '${id}')`);
  const checkRuntime = async (marker) => {
    await js(
      `window.dela.terminal.write('${id}', ${JSON.stringify(`dela help >/dev/null && printf '${marker}\\n'\r`)})`,
    );
    await wait(
      () =>
        js(
          `window.dela.terminal.list('${project.id}').then(items => items.some(item => item.id === '${id}' && item.buffer.includes('${marker}\\r\\n') && item.exitCode === null))`,
        ),
      'live PTY and bridge',
    );
  };
  await checkRuntime('BEFORE_CLOSE');
  window.show();
  window.close();
  assert.equal(window.isDestroyed(), false);
  assert.equal(window.isVisible(), false);
  app.emit('activate', {}, false);
  await wait(() => window.isVisible(), 'Dock activation restores window');
  assert.equal(BrowserWindow.getAllWindows().length, 1);
  await checkRuntime('AFTER_REOPEN');

  // 真正调用 app.quit，由 renderer 的 beforeunload 拦下；取消后终端/桥不得提前销毁。
  await js('window.onbeforeunload = () => false; void 0');
  app.quit();
  await wait(() => declined === 1, 'cancel unsaved-note exit');
  await checkRuntime('AFTER_CANCEL');
  window.close();
  assert.equal(window.isVisible(), false);
  app.emit('activate', {}, false);
  await wait(() => window.isVisible(), 'reopen after cancelled exit');

  await js(
    'window.dela.mail.onRequestClose(quitting => { window.mailQuitRequested = quitting; }); window.dela.mail.setComposeActive(true)',
  );
  app.quit();
  await wait(() => js('window.mailQuitRequested === true'), 'mail receives quit request');
  await checkRuntime('AFTER_MAIL_CANCEL');
  window.close();
  assert.equal(window.isVisible(), false);
  await js('window.onbeforeunload = null; window.dela.mail.setComposeActive(false)');
  console.log(
    'Desktop smoke passed: Mac titlebar safe area/zoom/font sizing, authorization window frame/reuse/bind after close, platform preload/menu, unsupported Mac conversion guard, focused-window close, close/reopen, cancelled note/mail exit preserves PTY and command bridge; no login registration.',
  );
}
