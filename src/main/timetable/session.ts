import { app, safeStorage, session, type Cookie, type Session } from 'electron';
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

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
