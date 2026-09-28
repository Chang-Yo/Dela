import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  shell,
  Tray,
} from 'electron';
import { registerTodoIpc, refreshTodos } from './todo';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { z } from 'zod';
import { closeDatabase, getDatabase } from './database';
import { registerMailIpc, hasMailComposer } from './mail/ipc';
import { registerTimetableIpc } from './timetable/ipc';
import { checkWorkspaceSender } from './ipc';
import { registerCanvasIpc } from './canvas/ipc';
import { registerShuiyuanIpc } from './shuiyuan/ipc';
import { registerPreviewProtocol, registerPreviewScheme } from './workspace/preview';
import { registerWorkspaceIpc } from './workspace/ipc';
import { registerSearchIpc } from './search';
import {
  initializeNotifications,
  registerNotificationsIpc,
  refreshNotifications,
} from './notifications';
import { getMailState, startMailSync } from './mail/api';
import { gcChatMedia } from './agent/media';
import type { IconPreference, ThemePreference } from '../shared/api';
import { fontScaleLevels, zoomLevels } from '../shared/api';

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

const themeSchema = z.enum(['system', 'light', 'dark']);
const iconSchema = z.enum(['white', 'black']);
const zoomSchema = z.number().refine((value) => (zoomLevels as readonly number[]).includes(value));
const fontScaleSchema = z
  .number()
  .refine((value) => (fontScaleLevels as readonly number[]).includes(value));
// 持久化为 '1'/'0'；键不存在（老版本升级、首次使用）视为默认开启。
const openAtLoginSchema = z
  .string()
  .transform((value) => value === '1')
  .catch(true);

function readSetting(key: string): string | undefined {
  const row = getDatabase().prepare('SELECT value FROM workspace_settings WHERE key=?').get(key) as
    { value: string } | undefined;
  return row?.value;
}

function savedTheme(): ThemePreference {
  return themeSchema.catch('system').parse(readSetting('theme'));
}

function savedIcon(): IconPreference {
  return iconSchema.catch('white').parse(readSetting('icon'));
}

function savedZoom(): number {
  return zoomSchema.catch(1).parse(Number(readSetting('zoom')));
}

function savedFontScale(): number {
  return fontScaleSchema.catch(1).parse(Number(readSetting('font-scale')));
}

function savedOpenAtLogin(): boolean {
  return openAtLoginSchema.parse(readSetting('open-at-login'));
}

function applyTheme(theme: ThemePreference): ThemePreference {
  nativeTheme.themeSource = theme;
  return theme;
}

function registerSettingsIpc(): void {
  ipcMain.handle('settings:get-theme', (event) => {
    checkWorkspaceSender(event);
    return savedTheme();
  });
  ipcMain.handle('settings:set-theme', (event, value) => {
    checkWorkspaceSender(event);
    const theme = themeSchema.parse(value);
    getDatabase()
      .prepare("INSERT OR REPLACE INTO workspace_settings VALUES ('theme', ?)")
      .run(theme);
    return applyTheme(theme);
  });
  // 图标偏好只持久化；窗口/任务栏图标在下次启动创建窗口时生效。
  ipcMain.handle('settings:get-icon', (event) => {
    checkWorkspaceSender(event);
    return savedIcon();
  });
  ipcMain.handle('settings:set-icon', (event, value) => {
    checkWorkspaceSender(event);
    const icon = iconSchema.parse(value);
    getDatabase().prepare("INSERT OR REPLACE INTO workspace_settings VALUES ('icon', ?)").run(icon);
    return icon;
  });
  // 页面缩放立即应用到调用窗口，并持久化供下次启动使用。
  ipcMain.handle('settings:get-zoom', (event) => {
    checkWorkspaceSender(event);
    return savedZoom();
  });
  ipcMain.handle('settings:set-zoom', (event, value) => {
    checkWorkspaceSender(event);
    const zoom = zoomSchema.parse(value);
    getDatabase()
      .prepare("INSERT OR REPLACE INTO workspace_settings VALUES ('zoom', ?)")
      .run(String(zoom));
    BrowserWindow.fromWebContents(event.sender)?.webContents.setZoomFactor(zoom);
    return zoom;
  });
  // 字号缩放由 renderer 以 CSS 变量生效，这里只负责持久化。
  ipcMain.handle('settings:get-font-scale', (event) => {
    checkWorkspaceSender(event);
    return savedFontScale();
  });
  ipcMain.handle('settings:set-font-scale', (event, value) => {
    checkWorkspaceSender(event);
    const scale = fontScaleSchema.parse(value);
    getDatabase()
      .prepare("INSERT OR REPLACE INTO workspace_settings VALUES ('font-scale', ?)")
      .run(String(scale));
    return scale;
  });
  // 开机自启：打包后以系统启动项为准（含任务管理器改动），开发运行不注册 electron.exe。
  ipcMain.handle('settings:get-open-at-login', (event) => {
    checkWorkspaceSender(event);
    return app.isPackaged ? app.getLoginItemSettings().openAtLogin : savedOpenAtLogin();
  });
  ipcMain.handle('settings:set-open-at-login', (event, value) => {
    checkWorkspaceSender(event);
    const enabled = z.boolean().parse(value);
    getDatabase()
      .prepare("INSERT OR REPLACE INTO workspace_settings VALUES ('open-at-login', ?)")
      .run(enabled ? '1' : '0');
    if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: enabled });
    return enabled;
  });
}

const smokeTest = process.argv.includes('--smoke-test');
// 水源通知每分钟更新；IMAP 沿用现有增量同步，每五分钟检查一次。
const NOTIFICATION_REFRESH_MS = 60_000;
const MAIL_REFRESH_MS = 5 * 60_000;
const TODO_REFRESH_MS = 15 * 60_000;
let todoTimer: ReturnType<typeof setInterval> | undefined;
let notificationTimer: ReturnType<typeof setInterval> | undefined;
let mailTimer: ReturnType<typeof setInterval> | undefined;
let tray: Tray | undefined;
let mainWindow: BrowserWindow | undefined;
let quitting = false;
let firstLaunch = false;
app.on('second-instance', () => {
  if (mainWindow && !mainWindow.isDestroyed()) showMainWindow(mainWindow);
  // 窗口尚未创建时，正常启动流程会显示它，不另建窗口。
});
if (smokeTest) {
  setTimeout(() => {
    console.error('Smoke check timed out');
    app.exit(1);
  }, 15000).unref();
}

// 注册业务 IPC；数据库在应用就绪后可用。
app.whenReady().then(() => {
  if (!hasSingleInstanceLock) return;
  // Windows 系统通知按 AppUserModelID 识别应用；与 electron-builder.yml 的 appId 一致，
  // 开发运行（未走安装器）也需要显式设置才能弹通知。
  if (process.platform === 'win32') app.setAppUserModelId('io.dela.desktop');
  // 标题栏内已有应用菜单；移除 Electron 默认菜单，避免额外的系统“退出”入口绕过托盘。
  Menu.setApplicationMenu(null);
  // 必须在建库前判断；旧版本即使没有引导标记，也不应在升级后重新引导。
  firstLaunch = !smokeTest && !existsSync(join(app.getPath('userData'), 'dela.db'));
  getDatabase();
  registerPreviewProtocol();
  applyTheme(savedTheme());
  // 开机自启默认开启：仅在首次初始化时登记默认值并注册系统启动项，
  // 之后不再于启动时改写，用户经任务管理器或本页开关的改动均以系统为准。
  if (app.isPackaged && readSetting('open-at-login') === undefined) {
    getDatabase()
      .prepare("INSERT OR REPLACE INTO workspace_settings VALUES ('open-at-login', ?)")
      .run('1');
    app.setLoginItemSettings({ openAtLogin: true });
  }
  registerSettingsIpc();
  registerMailIpc();
  registerTimetableIpc();
  registerCanvasIpc();
  registerShuiyuanIpc();
  registerWorkspaceIpc();
  registerSearchIpc();
  registerNotificationsIpc();
  registerTodoIpc();
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
  }
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
    minHeight: 440,
    show: !smokeTest,
    backgroundColor: '#f7f7f8',
    icon: join(app.getAppPath(), 'assets', `Dela_${savedIcon()}_bg.png`),
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: firstLaunch ? ['--dela-first-launch'] : [],
    },
  });
  mainWindow = window;
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
  session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.setPermissionCheckHandler(() => false);

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

  if (smokeTest) {
    const database = new Database(':memory:');
    try {
      database.exec('CREATE TABLE smoke (value TEXT NOT NULL)');
      database.prepare('INSERT INTO smoke VALUES (?)').run('ok');
      const row = database.prepare('SELECT value FROM smoke').get() as { value: string };
      if (row.value !== 'ok') throw new Error('SQLite smoke check failed');
      await new Promise((resolve) => setTimeout(resolve, 300));
      const rendered = await window.webContents.executeJavaScript(
        `document.querySelector('main') !== null && document.querySelector('aside[aria-label="主导航"]') !== null && window.dela?.version === ${JSON.stringify(app.getVersion())} && typeof window.dela?.settings.getTheme === 'function' && typeof window.dela?.settings.getIcon === 'function' && typeof window.dela?.settings.getZoom === 'function' && typeof window.dela?.settings.getFontScale === 'function' && typeof window.require === 'undefined'`,
      );
      if (!rendered) throw new Error('Renderer or preload smoke check failed');
      console.log('Smoke check passed: SQLite, renderer, preload isolation.');
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
        click: () => {
          quitting = true;
          app.quit();
        },
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
  if (process.platform !== 'darwin' || smokeTest) app.quit();
});
app.on('before-quit', () => {
  quitting = true;
});
app.on('will-quit', () => {
  tray?.destroy();
  clearInterval(todoTimer);
  clearInterval(notificationTimer);
  clearInterval(mailTimer);
  closeDatabase();
});
app.on('activate', () => {
  void createWindow().catch((error: unknown) => {
    console.error(error);
    app.exit(1);
  });
});
