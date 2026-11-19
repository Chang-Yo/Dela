// 经真实主进程打开水源授权窗，只替换远端页面和验证响应，不使用真实账号。
const { app, BrowserWindow } = require('electron');
const { dirname, join, resolve } = require('node:path');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { constants, publicEncrypt } = require('node:crypto');
const assert = require('node:assert/strict');
const root = resolve(process.argv[2] || '.');
app.setAppPath(root);
if (root.endsWith('.asar')) {
  Object.defineProperty(app, 'isPackaged', { value: true });
  process.resourcesPath = dirname(root);
}
const profile = mkdtempSync(join(tmpdir(), 'dela-shuiyuan-auth-'));
for (const name of ['userData', 'documents', 'home']) app.setPath(name, profile);
process.argv.push('--terminal-smoke-test');

app.once('browser-window-created', (_event, window) => {
  window.webContents.setBackgroundThrottling(false);
  window.webContents.once('did-finish-load', () => {
    void run(window)
      .then(() => app.exit(0))
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
      console.error('Failed shuiyuan auth fixture:', source);
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
  const loadURL = BrowserWindow.prototype.loadURL;
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
  await js("window.dela.bridge.invoke('shuiyuan:startAuth')");
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
  await js("window.dela.bridge.invoke('shuiyuan:startAuth')");
  assert.equal(authorization, first);
  assert.equal(BrowserWindow.getAllWindows().length, 2);
  first.close();
  await wait(() => first.isDestroyed(), 'authorization closed');
  assert.equal(window.isEnabled(), true);
  const bound = await js(
    `window.dela.bridge.invoke('shuiyuan:bind', ${JSON.stringify(encrypted)})`,
  );
  assert.equal(bound.connected, true);
  assert.equal(bound.username, 'desktop-fixture');
  console.log('Shuiyuan auth smoke passed: authorization window frame/reuse/bind after close.');
}
