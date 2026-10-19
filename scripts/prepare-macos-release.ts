import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Configuration } from 'electron-builder';

export function macReleaseConfig(root: string, env: NodeJS.ProcessEnv): Configuration {
  for (const name of [
    'CSC_LINK',
    'CSC_KEY_PASSWORD',
    'APPLE_ID',
    'APPLE_APP_SPECIFIC_PASSWORD',
    'APPLE_TEAM_ID',
  ]) {
    assert.ok(env[name]?.trim(), `缺少 ${name}`);
  }
  assert.match(env.APPLE_TEAM_ID!, /^[A-Z0-9]{10}$/, 'APPLE_TEAM_ID 格式无效');
  assert.notEqual(env.CSC_IDENTITY_AUTO_DISCOVERY, 'false', '签名候选不能禁用身份发现');
  return {
    extends: resolve(root, 'electron-builder.yml'),
    forceCodeSigning: true,
    mac: {
      identity: env.APPLE_TEAM_ID,
      hardenedRuntime: true,
      notarize: true,
      binaries: [
        'Contents/Resources/bin/darwin-arm64/rg',
        'Contents/Resources/bin/darwin-arm64/fd',
      ],
      // 语言数据由框架资源封印保护；逐文件签名会沿框架链接重复处理它们。
      signIgnore: ['\\.pak$'],
      publish: null,
    },
  };
}

if (import.meta.main) {
  assert.equal(process.platform, 'darwin', '请在 macOS 运行');
  assert.equal(process.arch, 'arm64', '签名候选仅支持 Apple Silicon');
  const root = resolve(import.meta.dirname, '..');
  const config = macReleaseConfig(root, process.env);
  mkdirSync(resolve(root, '.build'), { recursive: true });
  writeFileSync(resolve(root, '.build/macos-release.json'), JSON.stringify(config, null, 2));
  console.log('Mac 签名配置已生成；凭据仅从环境读取，不写入配置。');
}
