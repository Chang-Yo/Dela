#!/usr/bin/env node

import {
  constants,
  generateKeyPairSync,
  privateDecrypt,
  randomBytes,
  randomUUID,
} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const site = 'https://shuiyuan.sjtu.edu.cn';
const pendingFile = path.join(os.tmpdir(), 'dela-shuiyuan-user-api-key-test.pending.json');
const [command, ...args] = process.argv.slice(2);

function buildWeChatSafeAuthUrl(params) {
  const encode = (value) => encodeURIComponent(value).replace(/_/g, '%5F');
  return `${site}/user-api-key/new?${params
    .map(([key, value]) => `${encode(key)}=${encode(value)}`)
    .join('&')}`;
}

function removePendingFile() {
  if (fs.existsSync(pendingFile)) fs.unlinkSync(pendingFile);
}

function parsePayload(input) {
  const raw = String(input).trim();
  if (!raw) throw new Error('缺少加密 payload。');

  try {
    const url = new URL(raw);
    const fromUrl = url.searchParams.get('payload') ?? url.searchParams.get('encrypted_payload');
    if (fromUrl) return fromUrl;
  } catch {
    // Payload is not a URL.
  }

  const fromQuery = new URLSearchParams(raw.replace(/^\?/, '')).get('payload');
  return fromQuery ?? raw;
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let input = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      input += chunk;
    });
    process.stdin.on('end', () => resolve(input));
    process.stdin.on('error', reject);
  });
}

function init() {
  if (fs.existsSync(pendingFile)) {
    throw new Error(`已有未完成的测试会话：${pendingFile}。请先完成或手动删除该临时文件。`);
  }

  const clientId = randomUUID();
  const nonce = randomBytes(24).toString('base64url');
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

  fs.writeFileSync(
    pendingFile,
    `${JSON.stringify({ clientId, nonce, privateKey, expiresAt }, null, 2)}\n`,
    { encoding: 'utf8', mode: 0o600, flag: 'wx' },
  );

  console.log(
    buildWeChatSafeAuthUrl([
      ['application_name', 'Dela'],
      ['client_id', clientId],
      ['scopes', 'read'],
      ['public_key', publicKey],
      ['nonce', nonce],
    ]),
  );
}

async function finish() {
  if (!fs.existsSync(pendingFile)) {
    throw new Error('没有待完成的测试会话。请先运行 init。');
  }

  const pending = JSON.parse(fs.readFileSync(pendingFile, 'utf8'));
  if (Date.parse(pending.expiresAt) <= Date.now()) {
    removePendingFile();
    throw new Error('测试会话已过期。');
  }

  const payloadInput = args[0] ?? (await readStdin());
  const encryptedPayload = Buffer.from(
    parsePayload(payloadInput).replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/'),
    'base64',
  );
  const payload = JSON.parse(
    privateDecrypt(
      { key: pending.privateKey, padding: constants.RSA_PKCS1_PADDING },
      encryptedPayload,
    ).toString('utf8'),
  );
  if (payload.nonce !== pending.nonce || typeof payload.key !== 'string' || !payload.key) {
    throw new Error('回传 payload 无效或与本次测试不匹配。');
  }

  const headers = {
    Accept: 'application/json',
    'User-Api-Key': payload.key,
    'User-Api-Client-Id': pending.clientId,
  };
  const current = await fetch(`${site}/session/current.json`, { headers });
  if (!current.ok) throw new Error(`已解密 key，但只读验证返回 HTTP ${current.status}。`);

  const revoke = await fetch(`${site}/user-api-key/revoke`, { method: 'POST', headers });
  if (!revoke.ok) throw new Error(`只读验证通过，但撤销返回 HTTP ${revoke.status}。`);

  removePendingFile();
  console.log('PASS: payload 解密、只读验证和撤销均成功；临时私钥已删除。');
}

try {
  if (command === 'init') init();
  else if (command === 'finish') await finish();
  else throw new Error('用法：node scripts/test-shuiyuan-user-api-key.mjs <init|finish>');
} catch (error) {
  console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
