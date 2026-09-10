import { app, BrowserWindow, ipcMain } from 'electron';
import Database from 'better-sqlite3';
import { join } from 'node:path';
import { closeDatabase, getDatabase } from './database';
import { registerMailIpc } from './mail';

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
  registerMailIpc();
});

async function createWindow(): Promise<void> {
  const window = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 600,
    minHeight: 440,
    show: !smokeTest,
    backgroundColor: '#f7f7f8',
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
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
        "document.querySelector('main') !== null && document.querySelector('nav[aria-label=\"主导航\"]') !== null && window.dela?.version === '0.1.0' && typeof window.require === 'undefined'",
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
