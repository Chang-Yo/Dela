import { BrowserWindow, type WebContents } from 'electron';
import { generateKeyPairSync, privateDecrypt, randomBytes, constants } from 'node:crypto';
import { z } from 'zod';
import type { ShuiyuanState } from '../../shared/api';
import {
  clearShuiyuanCredential,
  loadShuiyuanCredential,
  saveShuiyuanCredential,
} from '../credentials';
import { CAMPUS_PARTITION, getCampusSession } from '../timetable/session';

const SHUIYUAN_ORIGIN = 'https://shuiyuan.sjtu.edu.cn';
// 授权页请求形态与 docs/shuiyuan-api-findings.md 的实测一致；不带 auth_redirect，
// 站点在页面内展示加密密文，由用户复制回 Dela 粘贴绑定。规划第一版只读。
const SHUIYUAN_SCOPES = 'read';
const REQUEST_TIMEOUT_MS = 15000;

interface PendingAuth {
  privPem: string;
  clientId: string;
  nonce: string;
}

/** 一次授权的临时私钥状态；仅存主进程内存，被下一次授权替换或随进程退出消失。 */
let pendingAuth: PendingAuth | null = null;

export function getShuiyuanState(): ShuiyuanState {
  const credential = loadShuiyuanCredential();
  return credential
    ? { connected: true, username: credential.username, boundAt: credential.boundAt }
    : { connected: false, username: null, boundAt: null };
}

export async function startShuiyuanAuth(sender: WebContents): Promise<void> {
  // 水源登录走 jAccount，与课表共用校园 Session，已登录过则无需再次输入。
  await getCampusSession();
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const clientId = randomBytes(16).toString('hex');
  const nonce = randomBytes(16).toString('hex');
  pendingAuth = {
    privPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    clientId,
    nonce,
  };
  const authorizeUrl = `${SHUIYUAN_ORIGIN}/user-api-key/new?${new URLSearchParams({
    scopes: SHUIYUAN_SCOPES,
    application_name: 'Dela',
    client_id: clientId,
    nonce,
    public_key: publicKey.export({ type: 'spki', format: 'pem' }).toString().trim(),
  })}`;
  const parent = BrowserWindow.fromWebContents(sender) ?? undefined;
  const authWindow = new BrowserWindow({
    width: 920,
    height: 720,
    minWidth: 680,
    minHeight: 520,
    parent,
    modal: parent !== undefined,
    autoHideMenuBar: true,
    title: '授权水源社区',
    webPreferences: {
      partition: CAMPUS_PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  try {
    await authWindow.loadURL(authorizeUrl);
  } catch (error) {
    if (!authWindow.isDestroyed()) authWindow.close();
    throw error;
  }
}

const decryptedPayloadSchema = z.object({
  key: z.string().min(1),
  nonce: z.string().min(1),
});

export async function bindShuiyuan(input: unknown): Promise<ShuiyuanState> {
  const payload = z.string().trim().min(1, '请先粘贴授权密文').parse(input).replace(/\s+/g, '');
  if (!pendingAuth) throw new Error('请先点击「登录并授权」发起授权');
  let decrypted: Buffer;
  try {
    decrypted = privateDecrypt(
      { key: pendingAuth.privPem, padding: constants.RSA_PKCS1_PADDING },
      Buffer.from(payload, 'base64'),
    );
  } catch {
    throw new Error('密文解密失败：内容可能复制不完整，请整段重新复制');
  }
  let parsed: z.infer<typeof decryptedPayloadSchema>;
  try {
    parsed = decryptedPayloadSchema.parse(JSON.parse(decrypted.toString('utf8')));
  } catch {
    throw new Error('密文内容无法识别，请重新发起授权');
  }
  if (parsed.nonce !== pendingAuth.nonce) {
    throw new Error('密文与本次授权不匹配，请重新点击「登录并授权」后再试');
  }
  const credential = await verifyAndStore(parsed.key, pendingAuth.clientId);
  pendingAuth = null;
  return {
    connected: true,
    username: credential.username,
    boundAt: credential.boundAt,
  };
}

async function verifyAndStore(key: string, clientId: string) {
  let response: Response;
  try {
    response = await fetch(`${SHUIYUAN_ORIGIN}/session/current.json`, {
      headers: { 'User-Api-Key': key, 'User-Api-Client-Id': clientId },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new Error('无法连接水源验证密钥，请检查网络后重试');
  }
  if (!response.ok) throw new Error(`水源拒绝了该密钥（HTTP ${response.status}）`);
  const current = (await response.json().catch(() => null)) as {
    current_user?: { username?: unknown };
  } | null;
  const username = current?.current_user?.username;
  if (typeof username !== 'string' || !username) {
    throw new Error('水源没有返回账号信息，请重新发起授权');
  }
  const credential = {
    key,
    clientId,
    username,
    boundAt: new Date().toISOString(),
  };
  saveShuiyuanCredential(credential);
  return credential;
}

export async function unbindShuiyuan(): Promise<void> {
  const credential = loadShuiyuanCredential();
  if (credential) {
    // 站点没有 key 管理界面，撤销必须在这里完成；失败时保留本地凭据供重试，
    // 否则 key 会变成谁都无法撤销的休眠凭据。
    let response: Response;
    try {
      response = await fetch(`${SHUIYUAN_ORIGIN}/user-api-key/revoke`, {
        method: 'POST',
        headers: {
          'User-Api-Key': credential.key,
          'User-Api-Client-Id': credential.clientId,
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new Error('无法联系水源撤销密钥，请检查网络后重试');
    }
    if (!response.ok && response.status !== 403 && response.status !== 404) {
      throw new Error(`撤销密钥失败（HTTP ${response.status}），请稍后重试`);
    }
  }
  clearShuiyuanCredential();
  pendingAuth = null;
}
