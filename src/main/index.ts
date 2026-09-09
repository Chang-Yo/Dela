import { app, BrowserWindow } from 'electron';
import Database from 'better-sqlite3';
import { join } from 'node:path';

const smokeTest = process.argv.includes('--smoke-test');
if (smokeTest) {
  setTimeout(() => {
    console.error('Smoke check timed out');
    app.exit(1);
  }, 15000).unref();
}

async function createWindow(): Promise<void> {
  const window = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 600,
    minHeight: 440,
    show: !smokeTest,
    backgroundColor: '#f6f5f2',
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
        "document.querySelector('h1')?.textContent === '你的项目工作台' && window.dela?.version === '0.1.0' && typeof window.require === 'undefined'",
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
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow().catch((error: unknown) => {
      console.error(error);
      app.exit(1);
    });
  }
});
