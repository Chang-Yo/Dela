import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell, Tray } from 'electron';
import { registerTodoIpc, refreshTodos } from './todo';
import { registerBackupIpc } from './backup';
import { registerCacheIpc } from './cache';
import { registerConsentIpc } from './consent';
import { join } from 'node:path';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { closeDatabase, getDatabase } from './database';
import { registerMailIpc, hasMailComposer } from './mail/ipc';
import { registerTimetableIpc } from './timetable/ipc';
import { registerVsjtuIpc } from './vsjtu/ipc';
import { attachContextMenu, isSameRendererNavigation } from './ipc';
import { registerCanvasIpc } from './canvas/ipc';
import { registerShuiyuanIpc } from './shuiyuan/ipc';
import { registerPreviewProtocol, registerPreviewScheme } from './workspace/preview';
import { registerWorkspaceIpc } from './workspace/ipc';
import { registerTerminalIpc } from './terminal';
import { cleanupLegacyMinGit, prependRuntimePath } from './terminal/mingit';
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
  invalidateSessions,
  loadPi,
  registerAgentIpc,
  subscribeChat,
} from './agent';
import {
  applyTheme,
  readSetting,
  registerSettingsIpc,
  savedIcon,
  savedTheme,
  savedZoom,
} from './settings';
import { registerUpdateIpc, startBackgroundUpdateCheck } from './update';

import Database from 'better-sqlite3';

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

ipcMain.handle('window:get-state', (event) => ({
  maximized: BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false,
}));

const terminalSmokeTest = process.argv.includes('--terminal-smoke-test');
const smokeTest = process.argv.includes('--smoke-test') || terminalSmokeTest;
const startHidden = process.argv.includes('--hidden');
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
let todoTimer: ReturnType<typeof setInterval> | undefined;
let notificationTimer: ReturnType<typeof setInterval> | undefined;
let mailTimer: ReturnType<typeof setInterval> | undefined;
let stopUpdateCheck: (() => void) | undefined;
let tray: Tray | undefined;
let mainWindow: BrowserWindow | undefined;
let quitting = false;
let firstLaunch = false;

// 托盘「退出」与引导条款页的「不同意并退出」共用：置位后 close 处理器不再拦成隐藏。
function quitApp() {
  quitting = true;
  app.quit();
}

ipcMain.on('window:quit', quitApp);
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
    app.setAppUserModelId('io.dela.desktop');
    // 标题栏内已有应用菜单；移除 Electron 默认菜单，避免额外的系统“退出”入口绕过托盘。
    Menu.setApplicationMenu(null);
    // 必须在建库前判断；旧版本即使没有引导标记，也不应在升级后重新引导。
    firstLaunch = !smokeTest && !existsSync(join(app.getPath('userData'), 'dela.db'));
    getDatabase();
    // 随包 MinGit 与搜索工具（rg/fd）前插 PATH：终端、Agent 的子进程一开始就能用 git/grep/find；
    // 随包已有运行时时，顺手清掉旧版本自装进用户目录的 MinGit 副本。
    prependRuntimePath();
    cleanupLegacyMinGit();
    registerPreviewProtocol();
    applyTheme(savedTheme());
    // 开机自启默认开启：仅在首次初始化时登记默认值并注册系统启动项，
    // 之后不再于启动时改写，用户经任务管理器或本页开关的改动均以系统为准。
    if (app.isPackaged && readSetting('open-at-login') === undefined) {
      getDatabase()
        .prepare("INSERT OR REPLACE INTO workspace_settings VALUES ('open-at-login', ?)")
        .run('1');
      app.setLoginItemSettings({ openAtLogin: true, args: ['--hidden'] });
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
      syncTodos();
      todoTimer = setInterval(syncTodos, TODO_REFRESH_MS);
      refresh();
      syncMail();
      notificationTimer = setInterval(refresh, NOTIFICATION_REFRESH_MS);
      mailTimer = setInterval(syncMail, MAIL_REFRESH_MS);
      stopUpdateCheck = startBackgroundUpdateCheck();
    }
  })
  .catch((error: unknown) => {
    // 数据库拒绝降级打开（「由更新版本的 Dela 创建」）就是从这里冒出来的：
    // 没有这个 catch 只会留下未处理的 rejection，用户看到的是「窗口一直不出现、也没提示」。
    console.error(error);
    dialog.showErrorBox('Dela 无法启动', error instanceof Error ? error.message : String(error));
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
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: [
        ...(firstLaunch ? ['--dela-first-launch'] : []),
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
    openExternalUrl(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (isSameRendererNavigation(window.webContents.getURL(), url)) return;
    event.preventDefault();
    openExternalUrl(url);
  });
  window.webContents.on('will-prevent-unload', (event) => {
    if (hasMailComposer(window.webContents.id)) {
      window.webContents.send('mail:request-close');
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
    if (choice === 0) event.preventDefault();
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
      console.log('Smoke check passed: SQLite, renderer, preload isolation, Agent runtime (ESM).');
    } finally {
      database.close();
    }
    app.quit();
  }
}

function showMainWindow(window: BrowserWindow): void {
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
  app.quit();
});
app.on('before-quit', () => {
  quitting = true;
  closeDomainBridge();
});
app.on('will-quit', () => {
  tray?.destroy();
  clearInterval(todoTimer);
  clearInterval(notificationTimer);
  clearInterval(mailTimer);
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
  void createWindow().catch((error: unknown) => {
    console.error(error);
    app.exit(1);
  });
});
