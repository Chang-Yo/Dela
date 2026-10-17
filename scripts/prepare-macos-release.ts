// 只生成候选包配置，不签名、不发布；凭据仅由 electron-builder 从进程环境读取。
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function macReleaseConfig(root: string, version: string, env: NodeJS.ProcessEnv) {
  assert.equal(env.RELEASE_TAG, `v${version}`, 'RELEASE_TAG 必须对应 package.json 版本');
  assert.match(version, /^\d+\.\d+\.\d+$/, '候选包以正式版本号验证 latest 渠道，不接受预发布版本');
  const feed = new URL(env.DELA_MAC_UPDATE_URL || '');
  assert.ok(
    feed.protocol === 'https:' && !feed.username && !feed.password && !feed.search && !feed.hash,
    'Mac 更新源必须是无凭据、查询参数和片段的 HTTPS 目录',
  );
  assert.ok(feed.pathname.endsWith('/'), 'Mac 更新源必须以 / 结尾');
  for (const name of [
    'CSC_LINK',
    'CSC_KEY_PASSWORD',
    'APPLE_API_KEY',
    'APPLE_API_KEY_ID',
    'APPLE_API_ISSUER',
    'APPLE_TEAM_ID',
  ]) {
    assert.ok(env[name]?.trim(), `缺少 ${name}`);
  }
  assert.notEqual(env.CSC_IDENTITY_AUTO_DISCOVERY, 'false', '候选包不能禁用签名身份发现');
  assert.match(env.APPLE_TEAM_ID!, /^[A-Z0-9]{10}$/, 'APPLE_TEAM_ID 格式无效');
  return {
    extends: resolve(root, 'electron-builder.yml'),
    forceCodeSigning: true,
    extraMetadata: { delaMacUpdates: true },
    mac: {
      target: [
        { target: 'dmg', arch: ['arm64'] },
        { target: 'zip', arch: ['arm64'] },
      ],
      hardenedRuntime: true,
      notarize: true,
      binaries: [
        'Contents/Resources/bin/darwin-arm64/rg',
        'Contents/Resources/bin/darwin-arm64/fd',
      ],
      publish: {
        provider: 'generic',
        url: feed.href,
        channel: 'latest',
        useMultipleRangeRequest: false,
      },
    },
  };
}

if (import.meta.main) {
  assert.equal(process.platform, 'darwin', '请在 macOS 运行');
  assert.equal(process.arch, 'arm64', '候选包仅支持 Apple Silicon');
  const root = resolve(import.meta.dirname, '..');
  const { version } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  const config = macReleaseConfig(root, version, process.env);
  assert.ok(
    readFileSync(process.env.APPLE_API_KEY!, 'utf8').includes('BEGIN PRIVATE KEY'),
    'APPLE_API_KEY 必须指向 .p8 文件',
  );
  mkdirSync(resolve(root, '.build'), { recursive: true });
  writeFileSync(resolve(root, '.build/macos-release.json'), JSON.stringify(config, null, 2));
  console.log('Mac 候选包配置已生成；仍需签名、公证、校验与两版升级验收。');
}
