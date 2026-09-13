import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron';
import Database from 'better-sqlite3';
import { join } from 'node:path';
import { z } from 'zod';
import { closeDatabase, getDatabase } from './database';
import { registerMailIpc } from './mail';
import { registerTimetableIpc } from './timetable';
import { checkWorkspaceSender, registerCanvasIpc } from './canvas';
import { registerPreviewProtocol, registerPreviewScheme, registerWorkspaceIpc } from './projects';
import type { IconPreference, ThemePreference } from '../shared/api';

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

function savedTheme(): ThemePreference {
  const value = getDatabase()
    .prepare("SELECT value FROM workspace_settings WHERE key='theme'")
    .get() as { value: string } | undefined;
  return themeSchema.catch('system').parse(value?.value);
}

function savedIcon(): IconPreference {
  const value = getDatabase()
    .prepare("SELECT value FROM workspace_settings WHERE key='icon'")
    .get() as { value: string } | undefined;
  return iconSchema.catch('white').parse(value?.value);
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
}

const smokeTest = process.argv.includes('--smoke-test');
if (smokeTest) {
  setTimeout(() => {
    console.error('Smoke check timed out');
    app.exit(1);
  }, 15000).unref();
}

// 注册业务 IPC；数据库在应用就绪后可用。
app.whenReady().then(() => {
  getDatabase();
  registerPreviewProtocol();
  applyTheme(savedTheme());
  registerSettingsIpc();
  registerMailIpc();
  registerTimetableIpc();
  registerCanvasIpc();
  registerWorkspaceIpc();
});

async function createWindow(): Promise<void> {
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
    },
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const external = new URL(url);
      if (external.protocol === 'https:' || external.protocol === 'http:') {
        void shell.openExternal(external.href);
      }
    } catch {
      // Keep unparseable popup targets inside the application boundary.
    }
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.on('will-prevent-unload', (event) => {
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
    await window.loadURL(devUrl);
  } else {
    await window.loadFile(join(__dirname, '../renderer/index.html'));
  }

  if (smokeTest) {
    const database = new Database(':memory:');
    try {
      database.exec('CREATE TABLE smoke (value TEXT NOT NULL)');
      database.prepare('INSERT INTO smoke VALUES (?)').run('ok');
      const row = database.prepare('SELECT value FROM smoke').get() as { value: string };
      if (row.value !== 'ok') throw new Error('SQLite smoke check failed');
      await new Promise((resolve) => setTimeout(resolve, 300));
      const rendered = await window.webContents.executeJavaScript(
        `document.querySelector('main') !== null && document.querySelector('aside[aria-label="主导航"]') !== null && window.dela?.version === ${JSON.stringify(app.getVersion())} && typeof window.dela?.settings.getTheme === 'function' && typeof window.dela?.settings.getIcon === 'function' && typeof window.require === 'undefined'`,
      );
      if (!rendered) throw new Error('Renderer or preload smoke check failed');
      console.log('Smoke check passed: SQLite, renderer, preload isolation.');
    } finally {
      database.close();
    }
    app.quit();
  }
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
app.on('will-quit', () => {
  closeDatabase();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow().catch((error: unknown) => {
      console.error(error);
      app.exit(1);
    });
  }
});
