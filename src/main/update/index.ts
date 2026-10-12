// 应用内更新：主进程是唯一真源。
//
// 为什么状态机放主进程而不是设置页：下载可能持续几分钟，用户随时会关掉设置页；
// 状态若由页面持有就会丢。这里渲染层只读快照、只派发动作，任何页面的挂载与卸载
// 都不影响进行中的更新。
//
// 通道语义：只有从微软商店安装的包才能让商店替我们校验和安装（也顺带解决了签名问题）。
// 自建分发（NSIS）的进程没有包标识，商店不认它，只能引导用户去商店页面。
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { checkWorkspaceSender } from '../ipc';
import { savedPendingInstall, setPendingInstall } from '../settings/prefs';
import { loadStoreUpdate, type NativeFailure, type StoreUpdateAddon } from './native';
import {
  failureEvent,
  initialUpdateState,
  reasonFromFailure,
  reduceUpdate,
  type UpdateEvent,
} from './state';
import type { UpdateSnapshot, UpdateStep } from '../../shared/update';

/**
 * Partner Center 的商店产品 ID，取自「应用概览 → 产品管理 → View app identity details」。
 * 只用于兜底入口：直接打开商品页，让商店自己决定展示「获取」还是「更新」。
 */
const STORE_PAGE_URL = 'ms-windows-store://pdp/?ProductId=9NCF8460RJM1';

/**
 * 后台检查的间隔。商店对检测接口限流（30 分钟内最多一次、24 小时最多十次），
 * 超限时返回的是上一次的结果而不是报错。两小时一次、加上启动那次，挂满一天约十三次，
 * 会略微越过这个上限——代价只是那之后的几次拿到陈旧结论，不会失败。
 */
export const BACKGROUND_CHECK_INTERVAL = 2 * 60 * 60 * 1000;

/**
 * 启动后先等一会儿再查：下载对话框要以应用窗口为属主，窗口得先就位，
 * 顺便避开启动期的磁盘与网络争用。
 */
export const BACKGROUND_CHECK_DELAY = 30_000;

/**
 * 启动后尽早准备上次推迟的更新，准备完成仍需用户确认安装。
 */
export const PENDING_INSTALL_DELAY = 5_000;

let snapshot: UpdateSnapshot | null = null;

function currentState(): UpdateSnapshot {
  snapshot ??= initialUpdateState({
    // Electron 只在 Windows 商店（appx）运行时置位，等价于「本进程有包标识」。
    channel: process.windowsStore === true ? 'store' : 'standalone',
    currentVersion: app.getVersion(),
  });
  return snapshot;
}

function broadcast(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue;
    window.webContents.send('update:state', currentState());
  }
}

function dispatch(event: UpdateEvent): UpdateSnapshot {
  snapshot = reduceUpdate(currentState(), event);
  broadcast();
  return snapshot;
}

/** 商店的对话框要以应用窗口为属主，否则 native 侧会拿到 0x80070578。 */
function ownerHandle(): Buffer | null {
  const window = BrowserWindow.getAllWindows().find((item) => !item.isDestroyed());
  return window ? window.getNativeWindowHandle() : null;
}

/** 失败摘要：只用于排查，不直接展示。 */
function describe(failure: NativeFailure): string {
  const code = failure.code === 0 ? '' : `0x${(failure.code >>> 0).toString(16)}`;
  return [failure.state, code, failure.message].filter(Boolean).join(' · ');
}

/**
 * 原生模块承诺不跨边界抛异常，但真抛了也必须兜住：状态若停在进行中，
 * 界面上的按钮会消失，用户除了重启没有别的出路。
 */
async function guarded(
  step: UpdateStep,
  run: () => Promise<UpdateSnapshot>,
): Promise<UpdateSnapshot> {
  try {
    return await run();
  } catch (error) {
    return dispatch(failureEvent(step, 'failed', error instanceof Error ? error.message : null));
  }
}

async function runCheck(addon: StoreUpdateAddon, handle: Buffer): Promise<UpdateSnapshot> {
  const result = await addon.check(handle);
  if (!result.ok) {
    return dispatch(failureEvent('check', reasonFromFailure(result), describe(result)));
  }
  const checkedAt = new Date().toISOString();
  if (result.updates.length === 0) return dispatch({ type: 'check/up-to-date', checkedAt });
  return dispatch({ type: 'check/available', updates: result.updates, checkedAt });
}

async function beginCheck(): Promise<UpdateSnapshot> {
  const previous = currentState();
  const started = dispatch({ type: 'check/started' });
  if (started === previous) return started;
  const addon = loadStoreUpdate();
  if (!addon) return dispatch(failureEvent('check', 'addon-missing', null));
  // 这两条不必问商店，先判掉：开发运行没有包标识，自建安装版商店也不管。
  if (!app.isPackaged) return dispatch(failureEvent('check', 'not-packaged', null));
  if (currentState().channel !== 'store') {
    return dispatch(failureEvent('check', 'not-store', null));
  }
  const handle = ownerHandle();
  if (!handle) return dispatch(failureEvent('check', 'window-handle', null));
  return guarded('check', () => runCheck(addon, handle));
}

async function runDownload(addon: StoreUpdateAddon, handle: Buffer): Promise<UpdateSnapshot> {
  const result = await addon.download(handle, (progress) =>
    dispatch({ type: 'download/progress', progress }),
  );
  if (result.ok) return dispatch({ type: 'download/finished' });
  return dispatch(failureEvent('download', reasonFromFailure(result), describe(result)));
}

async function beginDownload(): Promise<UpdateSnapshot> {
  const previous = currentState();
  const started = dispatch({ type: 'download/started' });
  if (started === previous) return started;
  const addon = loadStoreUpdate();
  if (!addon) return dispatch(failureEvent('download', 'addon-missing', null));
  const handle = ownerHandle();
  if (!handle) return dispatch(failureEvent('download', 'window-handle', null));
  return guarded('download', () => runDownload(addon, handle));
}

async function runInstall(addon: StoreUpdateAddon, handle: Buffer): Promise<UpdateSnapshot> {
  // Windows 可能在这个 await 返回之前就把本应用关掉，调用方不能把「拿到结果」当作前提。
  const result = await addon.install(handle);
  if (result.ok) return dispatch({ type: 'install/finished' });
  return dispatch(failureEvent('install', reasonFromFailure(result), describe(result)));
}

async function beginInstall(): Promise<UpdateSnapshot> {
  const previous = currentState();
  const started = dispatch({ type: 'install/started' });
  if (started === previous) return started;
  const addon = loadStoreUpdate();
  if (!addon) return dispatch(failureEvent('install', 'addon-missing', null));
  const handle = ownerHandle();
  if (!handle) return dispatch(failureEvent('install', 'window-handle', null));
  return guarded('install', async () => {
    setPendingInstall(false);
    return runInstall(addon, handle);
  });
}

export function registerUpdateIpc(): void {
  ipcMain.handle('update:get-state', (event) => {
    checkWorkspaceSender(event);
    return currentState();
  });
  ipcMain.handle('update:check', (event) => {
    checkWorkspaceSender(event);
    return beginCheck();
  });
  ipcMain.handle('update:download', (event) => {
    checkWorkspaceSender(event);
    return beginDownload();
  });
  ipcMain.handle('update:install', (event) => {
    checkWorkspaceSender(event);
    return beginInstall();
  });
  ipcMain.handle('update:defer-install', (event) => {
    checkWorkspaceSender(event);
    if (currentState().phase !== 'ready') return;
    setPendingInstall(true);
  });
  ipcMain.handle('update:open-store-page', async (event) => {
    checkWorkspaceSender(event);
    await shell.openExternal(STORE_PAGE_URL);
  });
}

/**
 * 后台检查：用户不打开设置页时，标题栏也要能提示有新版本。
 *
 * 只在「商店安装 + 有窗口」时进行。开发运行与自建安装版根本走不到商店，
 * 凑上去只会把状态从「还没检查」推成「不支持」，那是界面上不该出现的开场白；
 * 没有窗口时商店也无法为对话框找到属主（0x80070578）。
 */
function backgroundCheck(): void {
  if (!app.isPackaged) return;
  if (currentState().channel !== 'store') return;
  if (!ownerHandle()) return;
  void beginCheck();
}

/** 起一个后台检查循环，返回停止函数供退出时调用。 */
export function startBackgroundUpdateCheck(): () => void {
  const timer = setInterval(backgroundCheck, BACKGROUND_CHECK_INTERVAL);
  const initial = setTimeout(backgroundCheck, BACKGROUND_CHECK_DELAY);
  const pending = setTimeout(() => void preparePendingUpdate(), PENDING_INSTALL_DELAY);
  return () => {
    clearInterval(timer);
    clearTimeout(initial);
    clearTimeout(pending);
  };
}

/**
 * 准备上次选了「下次启动时提醒」的更新。
 *
 * 包已经下载过，所以这里必须再查一次再走一遍下载：状态机只认同一次运行内的
 * 阶段顺序，重启后快照是全新的 idle；已下载的包是否仍能查到，需商店实机验证。
 * 标记先清后准备，只尝试一次；下载完成后由界面提示，绝不自动安装。
 */
async function preparePendingUpdate(): Promise<void> {
  if (!app.isPackaged) return;
  if (currentState().channel !== 'store') {
    setPendingInstall(false);
    return;
  }
  if (!savedPendingInstall()) return;
  // 窗口还没就位：留着标记，下次启动再说（商店对话框要属主窗口）。
  if (!ownerHandle()) return;
  setPendingInstall(false);
  await beginCheck();
  if (currentState().phase !== 'available') return;
  await beginDownload();
}
