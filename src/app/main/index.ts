import {
  app,
  autoUpdater as electronAutoUpdater,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  safeStorage,
  shell,
  Tray,
} from 'electron';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { closeDatabase, getDatabase, SCHEMA_VERSION } from './database';
import { runMigrations } from './migrations';
import { checkWorkspaceSender } from './window';
import type { TrayAction } from '../preload/api';
import {
  attachContextMenu,
  registerPreviewProtocol,
  registerPreviewScheme,
} from '../../modules/workspace';
import { closeAllTerminals, locateBash, prependRuntimePath } from '../../modules/terminal';
import { closeHelper } from '../../core/remote/helper';
import { closeAllPortTunnels, closeRemoteOpens } from '../../modules/remotes';
import { closeRemoteWatch } from '../../core/remote/watch';
import { registerSearchProvider } from '../../modules/search';
import { registerModuleIpc } from './ipc';
import { modules } from '../modules';
import { hasMailComposer } from '../../modules/mail';
import { mailContract } from '../../modules/mail/contract';
import {
  closeDomainBridge,
  gcChatMedia,
  hasLiveSessions,
  loadPi,
  registerAgentIpc,
  shutdownSessions,
} from './agent-ipc';
import { emit, provideHostPorts } from '../../core/ports';
import { electronPorts } from './host-electron';
import {
  applyTheme,
  savedIcon,
  savedTheme,
  savedZoom,
  settingsSearch,
} from '../../modules/settings';

import Database from 'better-sqlite3';
import { spawn as spawnPty } from 'node-pty';

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

app.commandLine.appendSwitch('enable-smooth-scrolling');
// 默认 en-US 会让原生日期控件显示 AM/PM；强制与全中文界面一致。
app.commandLine.appendSwitch('lang', 'zh-CN');
registerPreviewScheme();

ipcMain.on('window:minimize', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.minimize();
});

ipcMain.on('window:toggle-maximize', (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) return;
  if (window.isMaximized()) {
    window.unmaximize();
  } else {
    window.maximize();
  }
});

ipcMain.on('window:close', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.close();
});

ipcMain.on('window:quit', (event) => {
  checkWorkspaceSender(event);
  quitApp();
});

ipcMain.handle('window:get-state', (event) => ({
  maximized: BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false,
}));

const terminalSmokeTest = process.argv.includes('--terminal-smoke-test');
const smokeTest = process.argv.includes('--smoke-test') || terminalSmokeTest;
let startHidden = process.argv.includes('--hidden');
if (smokeTest && !terminalSmokeTest) {
  const profile = mkdtempSync(join(tmpdir(), 'dela-smoke-'));
  app.setPath('userData', profile);
  app.setPath('documents', profile);
  app.setPath('home', profile);
}
let stopModules: (() => void)[] = [];
let tray: Tray | undefined;
let mainWindow: BrowserWindow | undefined;
let quitting = false;

// 托盘「退出」与引导条款页的「不同意并退出」共用：置位后 close 处理器不再拦成隐藏。
function quitApp() {
  quitting = true;
  app.quit();
}

electronAutoUpdater.on('before-quit-for-update', () => {
  quitting = true;
});

app.on('second-instance', () => {
  if (mainWindow && !mainWindow.isDestroyed()) showMainWindow(mainWindow);
});
if (smokeTest) {
  setTimeout(
    () => {
      console.error('Smoke check timed out');
      app.exit(1);
    },
    terminalSmokeTest ? 60000 : 15000,
  ).unref();
}

app
  .whenReady()
  .then(() => {
    if (!hasSingleInstanceLock) return;
    provideHostPorts(electronPorts);
    // Windows 通知按 AppUserModelID 识别应用，开发运行也要显式设置。
    if (process.platform === 'win32') app.setAppUserModelId('io.dela.desktop');
    if (process.platform === 'darwin') {
      const action = (value: TrayAction) => () => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        showMainWindow(mainWindow);
        mainWindow.webContents.send('window:tray-action', value);
      };
      Menu.setApplicationMenu(
        Menu.buildFromTemplate([
          {
            label: 'Dela',
            submenu: [
              { role: 'about' },
              { label: '设置…', click: action('open-settings') },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
          {
            label: '文件',
            submenu: [
              { label: '新建对话', click: action('new-chat') },
              { label: '新建项目', click: action('new-project') },
              // ⌘W 留给可配置的工作台关标签动作，原生菜单不抢同一组合。
              { label: '关闭窗口', click: (_item, window) => window?.close() },
            ],
          },
          { role: 'editMenu', label: '编辑' },
          { label: '视图', submenu: [{ role: 'togglefullscreen' }] },
          { role: 'windowMenu', label: '窗口' },
        ]),
      );
      if (app.isPackaged && !smokeTest) startHidden ||= app.getLoginItemSettings().wasOpenedAtLogin;
    } else Menu.setApplicationMenu(null);
    runMigrations(
      {
        userData: app.getPath('userData'),
        seal: {
          encrypt: (text) => safeStorage.encryptString(text),
          decrypt: (data) => safeStorage.decryptString(data),
        },
      },
      SCHEMA_VERSION,
    );
    getDatabase();
    // 随包 MinGit 与 rg/fd 前插 PATH，终端与 Agent 子进程开箱可用。
    prependRuntimePath();
    registerPreviewProtocol();
    applyTheme(savedTheme());
    if (process.platform === 'darwin') {
      app.dock?.setIcon(
        nativeImage.createFromPath(join(__dirname, 'icons', `Dela_${savedIcon()}_bg.png`)),
      );
    }
    registerAgentIpc();
    registerModuleIpc(modules);
    for (const module of modules) module.register?.();
    registerSearchProvider(settingsSearch);
    gcChatMedia();
    if (!smokeTest) {
      stopModules = modules.flatMap((module) => module.start?.() ?? []);
    }
  })
  .catch((error: unknown) => {
    // 数据库拒绝降级打开时走这里；没有 catch 用户只会看到窗口一直不出现。
    console.error(error);
    if (!smokeTest) {
      dialog.showErrorBox('Dela 无法启动', error instanceof Error ? error.message : String(error));
    }
    app.exit(1);
  });

function openExternalUrl(url: string): void {
  try {
    const external = new URL(url);
    if (external.protocol === 'https:' || external.protocol === 'http:') {
      void shell.openExternal(external.href);
    }
  } catch {
    // 无法解析的目标不外开。
  }
}

async function createWindow(): Promise<void> {
  if (!hasSingleInstanceLock) return;
  if (mainWindow && !mainWindow.isDestroyed()) {
    showMainWindow(mainWindow);
    return;
  }
  const window = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 600,
    // 容得下 @ 候选菜单向上展开（256px）+ composer + 头部。
    minHeight: 600,
    show: !smokeTest && !startHidden,
    backgroundColor: '#f7f7f8',
    icon: nativeImage.createFromPath(
      join(app.getAppPath(), 'assets', `Dela_${savedIcon()}_bg.png`),
    ),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    titleBarOverlay: process.platform === 'darwin',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: [
        ...(app.isPackaged && process.argv.includes('--updated') ? ['--dela-updated'] : []),
      ],
    },
  });
  mainWindow = window;
  attachContextMenu(window.webContents);
  window.on('closed', () => {
    mainWindow = undefined;
    closeAllTerminals();
  });
  window.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    window.hide();
  });
  const openLink = (url: string) => {
    if (!modules.some((module) => module.openLink?.(url))) openExternalUrl(url);
  };
  window.webContents.setWindowOpenHandler(({ url }) => {
    openLink(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    event.preventDefault();
    openLink(url);
  });
  window.webContents.on('will-prevent-unload', (event) => {
    const wasQuitting = quitting;
    quitting = false;
    if (hasMailComposer()) {
      emit(mailContract, 'requestClose', wasQuitting);
      return;
    }
    const choice = dialog.showMessageBoxSync(window, {
      type: 'warning',
      buttons: ['抛弃并退出', '继续编辑'],
      defaultId: 1,
      cancelId: 1,
      title: '仍有未保存的内容',
      message: '有未保存的笔记或未发送的邮件，确定抛弃并退出 Dela 吗？',
    });
    if (choice === 0) {
      quitting = wasQuitting;
      event.preventDefault();
    }
  });
  const session = window.webContents.session;
  // 仅放行剪贴板读写与全屏（终端粘贴、课堂视频），其余权限一律拒绝。
  const allowClipboardAndFullscreen = (_contents: unknown, permission: string) =>
    permission === 'clipboard-sanitized-write' ||
    permission === 'clipboard-read' ||
    permission === 'fullscreen';
  session.setPermissionRequestHandler((contents, permission, callback) =>
    callback(allowClipboardAndFullscreen(contents, permission)),
  );
  session.setPermissionCheckHandler(allowClipboardAndFullscreen);

  const sendWindowState = () => {
    window.webContents.send('window:state', { maximized: window.isMaximized() });
  };
  window.on('maximize', sendWindowState);
  window.on('unmaximize', sendWindowState);

  const devUrl = !app.isPackaged ? process.env.DELA_DEV_URL : undefined;
  if (devUrl) {
    if (new URL(devUrl).origin !== 'http://127.0.0.1:5173') {
      throw new Error('Unexpected development server origin');
    }
    await window.loadURL(smokeTest ? `${devUrl}?smoke-test=1` : devUrl);
  } else {
    await window.loadFile(
      join(__dirname, '../renderer/index.html'),
      smokeTest ? { query: { 'smoke-test': '1' } } : undefined,
    );
  }
  // 页面加载后再设置，避免导航重置缩放级别。
  window.webContents.setZoomFactor(savedZoom());

  if (!smokeTest) createTray(window);

  if (smokeTest && !terminalSmokeTest) {
    for (const name of ['white', 'black']) {
      const iconPath = join(app.getAppPath(), 'assets', `Dela_${name}_bg.png`);
      if (nativeImage.createFromPath(iconPath).isEmpty()) {
        throw new Error(`Application icon failed to load: ${iconPath}`);
      }
    }
    const database = new Database(':memory:');
    try {
      database.exec('CREATE TABLE smoke (value TEXT NOT NULL)');
      database.prepare('INSERT INTO smoke VALUES (?)').run('ok');
      const row = database.prepare('SELECT value FROM smoke').get() as { value: string };
      if (row.value !== 'ok') throw new Error('SQLite smoke check failed');
      await new Promise((resolve) => setTimeout(resolve, 300));
      const rendered = await window.webContents.executeJavaScript(
        `document.querySelector('main') !== null && document.querySelector('aside[aria-label="主导航"]') !== null && window.dela?.version === ${JSON.stringify(app.getVersion())} && typeof window.dela?.bridge.invoke === 'function' && typeof window.require === 'undefined'`,
      );
      if (!rendered) throw new Error('Renderer or preload smoke check failed');
      // Pi 是纯 ESM 包，只能动态 import 加载；冒烟覆盖 dev 与打包两条路径。
      const pi = await loadPi();
      if (typeof pi.createAgentSession !== 'function')
        throw new Error('Pi runtime smoke check failed');
      // 签名与 hardened runtime 可能让 PTY 起不来，打包产物要真起一次。
      await new Promise<void>((resolve, reject) => {
        const pty = spawnPty(locateBash(), ['--noprofile', '--norc', '-c', 'echo DELA_PTY_OK'], {
          cols: 80,
          rows: 24,
          ...(process.platform === 'win32' ? { useConptyDll: true } : {}),
        });
        let output = '';
        pty.onData((data) => {
          output += data;
          if (output.includes('DELA_PTY_OK')) resolve();
        });
        pty.onExit(({ exitCode }) => {
          if (exitCode !== 0) reject(new Error(`PTY smoke check failed (${exitCode}): ${output}`));
        });
      });
      console.log(
        'Smoke check passed: SQLite, renderer, preload isolation, Agent runtime (ESM), Bash PTY.',
      );
    } finally {
      database.close();
    }
    app.quit();
  }
}

function showMainWindow(window: BrowserWindow): void {
  if (process.platform === 'darwin') app.show();
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

function createTray(window: BrowserWindow): void {
  tray?.destroy();
  const icon = nativeImage
    .createFromPath(join(app.getAppPath(), 'assets', `Dela_${savedIcon()}_bg.png`))
    .resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('Dela');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '打开主窗口', click: () => showMainWindow(window) },
      { type: 'separator' },
      {
        label: '新建对话',
        click: () => {
          showMainWindow(window);
          window.webContents.send('window:tray-action', 'new-chat');
        },
      },
      {
        label: '新建项目',
        click: () => {
          showMainWindow(window);
          window.webContents.send('window:tray-action', 'new-project');
        },
      },
      { type: 'separator' },
      {
        label: '退出',
        click: quitApp,
      },
    ]),
  );
  tray.on('click', () => showMainWindow(window));
}

app
  .whenReady()
  .then(createWindow)
  .catch((error: unknown) => {
    console.error(error);
    app.exit(1);
  });
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
// 退出前停掉后台任务并结束会话，最多等 2 秒。拦在 before-quit：
// will-quit 被拦下后 Electron 不再响应之后的 app.quit()。
let sessionsClosed = false;
app.on('before-quit', (event) => {
  quitting = true;
  if (!sessionsClosed && hasLiveSessions()) {
    event.preventDefault();
    sessionsClosed = true;
    void shutdownSessions(2000).finally(() => app.quit());
  }
});
app.on('will-quit', () => {
  closeDomainBridge();
  tray?.destroy();
  for (const stop of stopModules) stop();
  // 远端 helper 靠心跳消失后自行退出，这里只关本地隧道；先收掉 watch，免得退出中重建通道。
  closeRemoteWatch();
  void closeHelper();
  closeAllPortTunnels();
  // 系统程序可能还开着为「用系统默认程序打开」下载的临时文件，删失败即可。
  void closeRemoteOpens();
  closeDatabase();
});
app.on('activate', () => {
  void createWindow()
    .then(() => {
      if (mainWindow) showMainWindow(mainWindow);
    })
    .catch((error: unknown) => {
      console.error(error);
      app.exit(1);
    });
});
