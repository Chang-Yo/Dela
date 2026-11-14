import { app, BrowserWindow, session } from 'electron';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { analyzeNoticePage, validateNoticeUrl } from './parser';
import { PAGE_BYTE_LIMIT } from './fetch';

const [urlArgument, directory, rawTimeout] = process.argv.slice(2);
const rawUrl = urlArgument?.startsWith('--notice-url=')
  ? urlArgument.slice('--notice-url='.length)
  : undefined;
if (!rawUrl || !directory) throw new Error('缺少渲染参数');
const url = validateNoticeUrl(rawUrl);
const timeoutMs = Number(rawTimeout);
if (!Number.isFinite(timeoutMs) || timeoutMs < 500 || timeoutMs > 60_000)
  throw new Error('渲染超时须在 500 至 60000 毫秒内');
app.setPath('userData', join(directory, 'profile'));
app.setPath('sessionData', join(directory, 'cache'));
app.commandLine.appendSwitch('disable-background-networking');

let window: BrowserWindow | undefined;
const startedAt = Date.now();
const timer = setTimeout(() => {
  console.error('网页渲染超时');
  window?.destroy();
  app.exit(1);
}, timeoutMs);

async function main() {
  await app.whenReady();
  const isolatedSession = session.fromPartition('notice-render', { cache: false });
  isolatedSession.setPermissionRequestHandler((_, __, callback) => callback(false));
  isolatedSession.setPermissionCheckHandler(() => false);
  isolatedSession.on('will-download', (event) => event.preventDefault());
  isolatedSession.webRequest.onBeforeRequest((details, callback) => {
    try {
      if (details.resourceType === 'mainFrame') validateNoticeUrl(details.url);
      callback({ cancel: false });
    } catch {
      callback({ cancel: true });
    }
  });
  window = new BrowserWindow({
    show: false,
    webPreferences: {
      session: isolatedSession,
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      backgroundThrottling: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  let httpStatus = 0;
  window.webContents.on('did-navigate', (_, __, status) => {
    httpStatus = status;
  });
  await window.loadURL(url);
  if (httpStatus < 200 || httpStatus >= 300) throw new Error(`页面 HTTP ${httpStatus}`);
  const loadedAt = Date.now();
  let previous = '';
  let previousEntries = '';
  let initialIds: Set<string> | undefined;
  let hasNewCandidates = false;
  let stableSince = Date.now();
  let documentStableSince = Date.now();
  while (true) {
    const html: string = await window.webContents.executeJavaScriptInIsolatedWorld(999, [
      {
        code: 'document.documentElement.outerHTML',
      },
    ]);
    if (Buffer.byteLength(html, 'utf8') > PAGE_BYTE_LIMIT)
      throw new Error('渲染页面超过 2 MiB 上限');
    if (html !== previous) {
      documentStableSince = Date.now();
      const analysis = analyzeNoticePage(html, window.webContents.getURL());
      initialIds ??= new Set(
        analysis.candidates.flatMap((candidate) => candidate.entries.map((entry) => entry.id)),
      );
      hasNewCandidates = analysis.candidates.some((candidate) =>
        candidate.entries.every((entry) => !initialIds!.has(entry.id)),
      );
      const entries = analysis.candidates.length
        ? JSON.stringify(analysis.candidates.map((candidate) => candidate.entries))
        : '';
      if (entries !== previousEntries) stableSince = Date.now();
      previousEntries = entries;
    }
    previous = html;
    const entriesStable = previousEntries && Date.now() - stableSince >= 750;
    const contentReady = hasNewCandidates && entriesStable;
    const observationComplete =
      Date.now() - startedAt >= timeoutMs - 500 &&
      (entriesStable || Date.now() - documentStableSince >= 750);
    if (Date.now() - loadedAt >= 1500 && (contentReady || observationComplete)) {
      await writeFile(
        join(directory!, 'page.json'),
        JSON.stringify({
          url: validateNoticeUrl(window.webContents.getURL()),
          html,
          fetchedAt: new Date().toISOString(),
        }),
      );
      return;
    }
    await delay(250);
  }
}

void main()
  .then(() => {
    clearTimeout(timer);
    window?.destroy();
    app.exit(0);
  })
  .catch((error: unknown) => {
    clearTimeout(timer);
    console.error(error instanceof Error ? error.message : String(error));
    window?.destroy();
    app.exit(1);
  });
