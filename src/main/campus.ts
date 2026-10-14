import {
  app,
  BrowserWindow,
  net,
  safeStorage,
  session,
  type Cookie,
  type Session,
  type WebContents,
} from 'electron';
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { attachContextMenu } from './ipc';

export const CAMPUS_PARTITION = 'persist:dela-campus';
let ready: Promise<Session> | undefined;
let persistenceError: Error | undefined;

function snapshotPath(): string {
  return join(app.getPath('userData'), 'campus-session.bin');
}

function campusCookie(cookie: Cookie): boolean {
  const domain = cookie.domain?.replace(/^\./, '') ?? '';
  return domain === 'sjtu.edu.cn' || domain.endsWith('.sjtu.edu.cn');
}

function cookieKey(cookie: Cookie): string {
  return JSON.stringify([cookie.domain, cookie.path, cookie.name]);
}

// Chromium 保存持久 Cookie；额外加密保存 session Cookie，不人为延长服务端有效期。
export function getCampusSession(): Promise<Session> {
  ready ??= (async () => {
    const campus = session.fromPartition(CAMPUS_PARTITION);
    const cookies = new Map<string, Cookie>();
    for (const cookie of await campus.cookies.get({})) cookies.set(cookieKey(cookie), cookie);
    const path = snapshotPath();
    if (existsSync(path)) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('当前系统不支持校园会话解密');
      const saved = JSON.parse(safeStorage.decryptString(readFileSync(path))) as Cookie[];
      for (const cookie of saved) {
        if (!campusCookie(cookie) || !cookie.session || cookies.has(cookieKey(cookie))) continue;
        await campus.cookies.set({
          url: `http${cookie.secure ? 's' : ''}://${cookie.domain!.replace(/^\./, '')}${cookie.path || '/'}`,
          name: cookie.name,
          value: cookie.value,
          domain: cookie.hostOnly ? undefined : cookie.domain,
          path: cookie.path,
          secure: cookie.secure,
          httpOnly: cookie.httpOnly,
          sameSite: cookie.sameSite,
        });
        cookies.set(cookieKey(cookie), cookie);
      }
    }
    campus.cookies.on('changed', (_event, cookie, _cause, removed) => {
      if (!campusCookie(cookie)) return;
      if (removed) cookies.delete(cookieKey(cookie));
      else cookies.set(cookieKey(cookie), cookie);
      try {
        const saved = [...cookies.values()].filter((value) => value.session && campusCookie(value));
        if (saved.length === 0) rmSync(path, { force: true });
        else {
          if (!safeStorage.isEncryptionAvailable()) throw new Error('当前系统不支持校园会话加密');
          writeFileSync(`${path}.tmp`, safeStorage.encryptString(JSON.stringify(saved)));
          renameSync(`${path}.tmp`, path);
        }
        persistenceError = undefined;
      } catch {
        persistenceError = new Error('校园登录会话保存失败，请检查本机存储后重新登录');
      }
    });
    return campus;
  })();
  return ready;
}

export async function flushCampusSession(): Promise<void> {
  const campus = await getCampusSession();
  await campus.cookies.flushStore();
  campus.flushStorageData();
  if (persistenceError) throw persistenceError;
}

export async function clearCampusSession(): Promise<void> {
  const campus = await getCampusSession();
  await campus.clearStorageData();
  await campus.cookies.flushStore();
  rmSync(snapshotPath(), { force: true });
  rmSync(`${snapshotPath()}.tmp`, { force: true });
  persistenceError = undefined;
}

export interface CampusRequestOptions {
  /** 用户可见的服务名，拼进超时、断网等报错文案。 */
  service: string;
  /** 登录失效（重定向、401/403）时的报错。 */
  loginError: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
}

/**
 * 经校园 Session 发请求并取回正文。Electron session.fetch 在内部构造 Response 时可能抛出
 * 未捕获的状态码异常，因此直接消费 Chromium 响应。重定向一律视为登录失效；
 * 超时、断网与 408/5xx 失败的 `cause` 为 'transient'，由调用方决定是否重试。
 */
export function campusRequest(
  campus: Session,
  url: string,
  options: CampusRequestOptions,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = net.request({
      url,
      method: options.method ?? 'GET',
      session: campus,
      useSessionCookies: true,
      redirect: 'manual',
    });
    let settled = false;
    const fail = (error: Error, transient = false) => {
      if (settled) return;
      settled = true;
      if (transient) error.cause = 'transient';
      clearTimeout(timer);
      reject(error);
      request.abort();
    };
    const timer = setTimeout(
      () => fail(new Error(`${options.service}请求超时，请稍后重试`), true),
      15000,
    );
    request.on('error', () => fail(new Error(`无法连接${options.service}，请检查网络`), true));
    request.on('redirect', () => fail(new Error(options.loginError)));
    request.on('response', (response) => {
      const status = response.statusCode;
      if (!Number.isInteger(status) || status < 200 || status > 599) {
        fail(new Error(`${options.service}返回了无效状态，请稍后重试或重新登录`));
        return;
      }
      if (status === 401 || status === 403 || (status >= 300 && status < 400)) {
        fail(new Error(options.loginError));
        return;
      }
      if (status !== 200) {
        fail(
          new Error(`${options.service}接口返回 ${status}`),
          [408, 500, 502, 503, 504].includes(status),
        );
        return;
      }
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      const interrupted = () => fail(new Error(`${options.service}响应中断，请稍后重试`), true);
      response.on('error', interrupted);
      response.on('aborted', interrupted);
      response.on('end', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(Buffer.concat(chunks).toString('utf8'));
      });
    });
    for (const [name, value] of Object.entries(options.headers ?? {}))
      request.setHeader(name, value);
    request.end(options.body);
  });
}

export interface CampusLoginOptions {
  readonly sender: WebContents;
  readonly title: string;
  /** 登录窗加载的入口地址（校园域内会触发 jAccount SSO）。 */
  readonly url: string;
  /** 导航 URL 是否已到达目标校园域（登录页自身不算）。 */
  readonly reached: (url: string) => boolean;
  /** 到达后探测登录是否真正生效；reject 即失败收场。 */
  readonly probe: () => Promise<void>;
  /**
   * 入口页本身就在目标域时（课堂视频）：首次导航必然尚未登录，
   * 探测失败不关窗；页内导航及定时重探覆盖 SPA 与异步登录完成。
   */
  readonly retryProbe?: boolean;
}

/** 校园域登录窗（课表与课堂视频共用）：到达目标域后探测，成功即关闭并清空待决结果。 */
export async function openCampusLoginWindow(
  options: CampusLoginOptions,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await getCampusSession();
  return new Promise((resolve) => {
    const parent = BrowserWindow.fromWebContents(options.sender) ?? undefined;
    const loginWindow = new BrowserWindow({
      width: 920,
      height: 720,
      minWidth: 680,
      minHeight: 520,
      parent,
      modal: parent !== undefined,
      autoHideMenuBar: true,
      title: options.title,
      webPreferences: {
        partition: CAMPUS_PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    attachContextMenu(loginWindow.webContents);
    let completed = false;
    let retryTimer: ReturnType<typeof setInterval> | undefined;
    const finish = (result: { ok: true } | { ok: false; error: string }) => {
      if (completed) return;
      completed = true;
      clearInterval(retryTimer);
      resolve(result);
      if (!loginWindow.isDestroyed()) loginWindow.close();
    };
    let checking = false;
    let currentUrl = '';
    const checkNavigation = async (url: string) => {
      currentUrl = url;
      if (options.reached(url) && !checking && !completed) {
        checking = true;
        try {
          await options.probe();
          finish({ ok: true });
        } catch (error) {
          if (options.retryProbe) {
            checking = false;
            return;
          }
          finish({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      }
    };
    loginWindow.webContents.on('did-navigate', (_event, url) => void checkNavigation(url));
    if (options.retryProbe) {
      loginWindow.webContents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
        if (isMainFrame) void checkNavigation(url);
      });
      // SPA 可能通过异步请求完成登录而不导航。串行探测，窗口关闭即停止。
      retryTimer = setInterval(() => void checkNavigation(currentUrl), 1000);
    }
    loginWindow.on('closed', () => {
      clearInterval(retryTimer);
      if (!completed) {
        completed = true;
        resolve({ ok: false, error: '未完成登录' });
      }
    });
    void loginWindow.loadURL(options.url).catch((error: unknown) => {
      finish({ ok: false, error: error instanceof Error ? error.message : String(error) });
    });
  });
}
