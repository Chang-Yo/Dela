import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { macReleaseConfig } from '../prepare-macos-release';
import { verifyMacUpdateArtifacts } from '../verify-macos-update';

const env = {
  RELEASE_TAG: 'v1.2.3',
  DELA_MAC_UPDATE_URL: 'https://updates.example.test/mac/',
  CSC_LINK: 'test-certificate',
  CSC_KEY_PASSWORD: 'test-password',
  APPLE_API_KEY: '/test/key.p8',
  APPLE_API_KEY_ID: 'test-key-id',
  APPLE_API_ISSUER: 'test-issuer',
  APPLE_TEAM_ID: 'ABCDEFGHIJ',
};

it('候选配置强制签名、公证与 arm64，不包含任何凭据或 Windows 覆盖', () => {
  const config = macReleaseConfig('/repo', '1.2.3', env);
  expect(config).toMatchObject({
    forceCodeSigning: true,
    extraMetadata: { delaMacUpdates: true },
    mac: { notarize: true, hardenedRuntime: true, publish: { url: env.DELA_MAC_UPDATE_URL } },
  });
  expect(config.mac.target).toEqual([
    { target: 'dmg', arch: ['arm64'] },
    { target: 'zip', arch: ['arm64'] },
  ]);
  expect(config).not.toHaveProperty('win');
  const encoded = JSON.stringify(config);
  for (const [key, value] of Object.entries(env)) {
    if (key !== 'DELA_MAC_UPDATE_URL' && key !== 'RELEASE_TAG')
      expect(encoded).not.toContain(value);
  }
});

it.each([
  'CSC_LINK',
  'CSC_KEY_PASSWORD',
  'APPLE_API_KEY',
  'APPLE_API_KEY_ID',
  'APPLE_API_ISSUER',
  'APPLE_TEAM_ID',
])('缺少 %s 不能生成候选配置', (name) => {
  expect(() => macReleaseConfig('/repo', '1.2.3', { ...env, [name]: '' })).toThrow(name);
});

it.each([
  'http://updates.example.test/',
  'https://user:password@example.test/',
  'https://example.test/?token=private',
  'https://example.test/mac',
])('拒绝不适合公开更新源的地址 %s', (url) => {
  expect(() => macReleaseConfig('/repo', '1.2.3', { ...env, DELA_MAC_UPDATE_URL: url })).toThrow();
});

it('拒绝错 tag、预发布版本或禁用签名的环境', () => {
  expect(() => macReleaseConfig('/repo', '1.2.4', env)).toThrow('RELEASE_TAG');
  expect(() =>
    macReleaseConfig('/repo', '1.2.3-beta.1', { ...env, RELEASE_TAG: 'v1.2.3-beta.1' }),
  ).toThrow('正式版本号');
  expect(() =>
    macReleaseConfig('/repo', '1.2.3', { ...env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' }),
  ).toThrow('签名');
});

const directories: string[] = [];
afterEach(() =>
  directories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })),
);

function artifacts() {
  const directory = mkdtempSync(join(tmpdir(), 'dela-mac-update-'));
  directories.push(directory);
  const content = Buffer.from('synthetic package');
  const files = ['zip', 'dmg'].map((ext) => {
    const url = `Dela-1.2.3-mac-arm64.${ext}`;
    writeFileSync(join(directory, url), content);
    return {
      url,
      size: content.length,
      sha512: createHash('sha512').update(content).digest('base64'),
    };
  });
  const metadata = { version: '1.2.3', files };
  const save = () => writeFileSync(join(directory, 'latest-mac.yml'), JSON.stringify(metadata));
  save();
  return { directory, metadata, save };
}

it('读取实际更新元数据并核对两份文件的版本、大小和哈希', async () => {
  const { directory } = artifacts();
  await expect(verifyMacUpdateArtifacts(directory, '1.2.3')).resolves.toBeUndefined();
  writeFileSync(join(directory, 'Dela-1.2.3-mac-arm64.zip'), 'tampered package');
  await expect(verifyMacUpdateArtifacts(directory, '1.2.3')).rejects.toThrow();
});

it.each(['missing-zip', 'wrong-arch', 'wrong-version', 'wrong-hash'])(
  '拒绝不完整或错误的更新产物 %s',
  async (scenario) => {
    const { directory, metadata, save } = artifacts();
    if (scenario === 'missing-zip') metadata.files.shift();
    if (scenario === 'wrong-arch') metadata.files[0].url = 'Dela-1.2.3-mac-x64.zip';
    if (scenario === 'wrong-version') metadata.version = '1.2.4';
    if (scenario === 'wrong-hash') metadata.files[0].sha512 = 'invalid';
    save();
    await expect(verifyMacUpdateArtifacts(directory, '1.2.3')).rejects.toThrow();
  },
);
