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
import { registerTodoIpc, refreshTodos } from './todo';
import { registerBackupIpc } from './backup';
import { registerCacheIpc } from './cache';
import { registerConsentIpc } from './consent';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { closeDatabase, getDatabase, SCHEMA_VERSION } from './database';
import { runMigrations } from './migrations';
import { registerMailIpc, hasMailComposer } from './mail/ipc';
import { registerTimetableIpc } from './timetable/ipc';
import { registerVsjtuIpc } from './vsjtu/ipc';
import { attachContextMenu, checkWorkspaceSender } from './ipc';
import type { TrayAction } from '../shared/window';
import { registerCanvasIpc, refreshCanvasTrees } from './canvas/ipc';
import { runCanvasCacheCleanup } from './canvas/api';
import { registerShuiyuanIpc } from './shuiyuan/ipc';
import { openShuiyuanLinkInApp } from './shuiyuan/links';
import { registerPreviewProtocol, registerPreviewScheme } from './workspace/preview';
import { registerWorkspaceIpc } from './workspace/ipc';
import { registerTerminalIpc, locateBash } from './terminal';
import { prependRuntimePath } from './terminal/mingit';
import { closeHelper } from './remotes/helper';
import { closeAllPortTunnels } from './remotes/ports';
import { closeRemoteWatch } from './remotes/watch';
import { closeRemoteOpens } from './remotes/transfer';
import { registerRemoteIpc } from './remotes/ipc';
import { registerSearchIpc } from './search';
import {
  initializeNotifications,
  registerNotificationsIpc,
  refreshNotifications,
} from './notifications';
import { getMailState, startMailSync } from './mail/api';
import {
  closeDomainBridge,
  gcChatMedia,
  hasLiveSessions,
  invalidateSessions,
  loadPi,
  registerAgentIpc,
  shutdownSessions,
  subscribeChat,
} from './agent';
import { applyTheme, registerSettingsIpc, savedIcon, savedTheme, savedZoom } from './settings';
import { registerUpdateIpc, startBackgroundUpdateCheck } from './update';

import Database from 'better-sqlite3';
import { spawn as spawnPty } from 'node-pty';

// 在数据库、窗口和托盘初始化前抢占锁，重复启动只唤起已有实例。
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

// Chromium 默认按滚轮格数瞬时跳变；开启后对滚轮输入做逐帧插值，滚动平滑。
app.commandLine.appendSwitch('enable-smooth-scrolling');
// Electron 界面语言默认 en-US，原生日期/时间控件会渲染成 MM/DD/YYYY AM/PM；
// 应用界面全中文，强制 Chromium locale 一致。
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
// 水源通知每分钟更新；IMAP 沿用现有增量同步，每五分钟检查一次。
const NOTIFICATION_REFRESH_MS = 60_000;
const MAIL_REFRESH_MS = 5 * 60_000;
const TODO_REFRESH_MS = 15 * 60_000;
// Canvas 课件目录树只拉清单不下载文件，每小时同步一次足够。
const CANVAS_REFRESH_MS = 60 * 60_000;
let todoTimer: ReturnType<typeof setInterval> | undefined;
let notificationTimer: ReturnType<typeof setInterval> | undefined;
let mailTimer: ReturnType<typeof setInterval> | undefined;
let canvasTimer: ReturnType<typeof setInterval> | undefined;
let stopUpdateCheck: (() => void) | undefined;
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
  // 窗口尚未创建时，正常启动流程会显示它，不另建窗口。
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

// 注册业务 IPC；数据库在应用就绪后可用。
app
  .whenReady()
  .then(() => {
    if (!hasSingleInstanceLock) return;
    // Windows 系统通知按 AppUserModelID 识别应用；与 electron-builder.yml 的 appId 一致，
    // 开发运行（未走安装器）也需要显式设置才能弹通知。
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
    // 随包 MinGit 与搜索工具（rg/fd）前插 PATH：终端、Agent 的子进程一开始就能用 git/grep/find；
    prependRuntimePath();
    registerPreviewProtocol();
    applyTheme(savedTheme());
    if (process.platform === 'darwin') {
      app.dock?.setIcon(
        nativeImage.createFromPath(join(__dirname, 'icons', `Dela_${savedIcon()}_bg.png`)),
      );
    }
    registerSettingsIpc();
    registerConsentIpc();
    registerBackupIpc();
    registerCacheIpc();
    registerMailIpc();
    registerTimetableIpc();
    registerVsjtuIpc();
    registerCanvasIpc();
    registerShuiyuanIpc();
    registerAgentIpc();
    registerWorkspaceIpc(subscribeChat, invalidateSessions);
    registerTerminalIpc();
    registerRemoteIpc();
    registerSearchIpc();
    registerNotificationsIpc();
    registerTodoIpc();
    registerUpdateIpc();
    initializeNotifications();
    // 回收未被任何会话引用的内联图片（上次运行遗留的草稿图片等）。
    gcChatMedia();
    if (!smokeTest) {
      void runCanvasCacheCleanup().catch((error: unknown) =>
        console.error('Canvas cache cleanup failed', error),
      );
      const refresh = () => {
        void refreshNotifications().catch((error: unknown) =>
          console.error('Notification refresh failed', error),
        );
      };
      const syncMail = () => {
        try {
          if (getMailState().account) startMailSync();
        } catch (error) {
          console.error('Mail background sync failed', error);
        }
      };
      const syncTodos = () => {
        void refreshTodos().catch((error: unknown) => console.error('TODO sync failed', error));
      };
      const syncCanvasTrees = () => {
        void refreshCanvasTrees().catch((error: unknown) =>
          console.error('Canvas tree sync failed', error),
        );
      };
      syncTodos();
      todoTimer = setInterval(syncTodos, TODO_REFRESH_MS);
      refresh();
      syncMail();
      syncCanvasTrees();
      canvasTimer = setInterval(syncCanvasTrees, CANVAS_REFRESH_MS);
      notificationTimer = setInterval(refresh, NOTIFICATION_REFRESH_MS);
      mailTimer = setInterval(syncMail, MAIL_REFRESH_MS);
      stopUpdateCheck = startBackgroundUpdateCheck();
    }
  })
  .catch((error: unknown) => {
    // 数据库拒绝降级打开（「由更新版本的 Dela 创建」）就是从这里冒出来的：
    // 没有这个 catch 只会留下未处理的 rejection，用户看到的是「窗口一直不出现、也没提示」。
    console.error(error);
    if (!smokeTest) {
      dialog.showErrorBox('Dela 无法启动', error instanceof Error ? error.message : String(error));
    }
    app.exit(1);
  });

// 只把 http(s) 链接交给系统浏览器；无法解析的目标一律留在应用边界内。
function openExternalUrl(url: string): void {
  try {
    const external = new URL(url);
    if (external.protocol === 'https:' || external.protocol === 'http:') {
      void shell.openExternal(external.href);
    }
  } catch {
    // Keep unparseable targets inside the application boundary.
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
    // 最小高度要容得下「@ 候选菜单向上展开（最高 256px）+ composer + 头部」，
    // 再紧就会像菜单顶出窗口上沿。
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
  });
  window.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    window.hide();
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (!openShuiyuanLinkInApp(url)) openExternalUrl(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    event.preventDefault();
    if (!openShuiyuanLinkInApp(url)) openExternalUrl(url);
  });
  window.webContents.on('will-prevent-unload', (event) => {
    const wasQuitting = quitting;
    quitting = false;
    if (hasMailComposer(window.webContents.id)) {
      window.webContents.send('mail:request-close', wasQuitting);
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
  // 渲染进程的 navigator.clipboard.writeText 走 clipboard-sanitized-write 权限；
  // 终端粘贴的 navigator.clipboard.readText 走 clipboard-read 权限；
  // 课堂视频 <video> 的原生全屏按钮走 fullscreen 权限；其余（通知、定位等）一律拒绝。
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
    // 冒烟运行经 URL 参数告知 renderer 跳过首启开屏等一次性界面。
    await window.loadURL(smokeTest ? `${devUrl}?smoke-test=1` : devUrl);
  } else {
    await window.loadFile(
      join(__dirname, '../renderer/index.html'),
      smokeTest ? { query: { 'smoke-test': '1' } } : undefined,
    );
  }
  // 恢复持久化的页面缩放；在页面加载后设置，避免导航重置缩放级别。
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
        `document.querySelector('main') !== null && document.querySelector('aside[aria-label="主导航"]') !== null && window.dela?.version === ${JSON.stringify(app.getVersion())} && typeof window.dela?.settings.getTheme === 'function' && typeof window.dela?.settings.getIcon === 'function' && typeof window.dela?.settings.getZoom === 'function' && typeof window.dela?.settings.getFontSize === 'function' && typeof window.require === 'undefined'`,
      );
      if (!rendered) throw new Error('Renderer or preload smoke check failed');
      // Pi 是纯 ESM 包，只能经动态 import 在 CJS 产物中加载（agent/pi.ts）；
      // 冒烟在 dev 与打包产物两条路径都跑，覆盖该加载真实可用。
      const pi = await loadPi();
      if (typeof pi.createAgentSession !== 'function')
        throw new Error('Pi runtime smoke check failed');
      // 签名与 hardened runtime 可能让 spawn-helper / ConPTY 起不来，打包产物要真起一次 PTY。
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
// 退出前先结束 Agent 会话：扩展在 session_shutdown 里关掉自己起的子进程（如 MCP 服务器）。
// 收尾是异步的，先拦下这一次退出，最多等 2 秒再退出。拦在 before-quit：will-quit 被拦下后
// Electron 不再响应之后的 app.quit()。
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
  clearInterval(todoTimer);
  clearInterval(notificationTimer);
  clearInterval(mailTimer);
  clearInterval(canvasTimer);
  stopUpdateCheck?.();
  // 远端 helper 不等我们说再见：它靠心跳消失后自己退出（最多 5 分钟），这里只关本地隧道。
  // watch 的事件流要先收掉，否则它会在退出过程中试图把通道重新建起来。
  closeRemoteWatch();
  void closeHelper();
  // 端口预览的独立隧道跟 helper 通道无关，也要收掉本地 ssh 进程。
  closeAllPortTunnels();
  // 为「用系统默认程序打开」下载的临时文件：系统程序可能还开着它，删失败就算了（临时目录）。
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
