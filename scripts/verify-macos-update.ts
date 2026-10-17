// 候选包必须同时具有有效更新元数据、Developer ID 签名与公证票据。
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
// 使用已锁定的 updater 自身所用的 YAML 解析器，不增加另一份解析依赖。
const { load } = createRequire(require.resolve('electron-updater'))('js-yaml') as {
  load: (text: string) => unknown;
};

export async function verifyMacUpdateArtifacts(directory: string, version: string) {
  const metadata = load(readFileSync(join(directory, 'latest-mac.yml'), 'utf8')) as {
    version: string;
    files: { url: string; sha512: string; size: number }[];
  };
  assert.equal(metadata.version, version, '更新元数据版本不匹配');
  assert.ok(Array.isArray(metadata.files), '缺少更新文件列表');
  const expected = ['dmg', 'zip'].map((ext) => `Dela-${version}-mac-arm64.${ext}`);
  assert.deepEqual(
    metadata.files.map((file) => file.url).sort(),
    expected.sort(),
    '更新源必须仅引用同版本 arm64 DMG/ZIP',
  );
  for (const file of metadata.files) {
    const path = join(directory, file.url);
    assert.equal(statSync(path).size, file.size, '更新文件大小不匹配');
    const hash = createHash('sha512');
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    assert.equal(hash.digest('base64'), file.sha512, '更新文件 SHA-512 不匹配');
  }
}

if (import.meta.main) {
  assert.equal(process.platform, 'darwin');
  const root = resolve(import.meta.dirname, '..');
  const bundle = resolve(process.argv[2] || join(root, 'dist/mac-arm64/Dela.app'));
  const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const feed = load(readFileSync(join(bundle, 'Contents/Resources/app-update.yml'), 'utf8')) as {
    provider: string;
    url: string;
  };
  assert.equal(feed.provider, 'generic');
  assert.equal(feed.url, new URL(process.env.DELA_MAC_UPDATE_URL!).href);
  await verifyMacUpdateArtifacts(resolve(bundle, '../..'), version);
  const builder = createRequire(require.resolve('electron-builder'));
  const asar = createRequire(builder.resolve('app-builder-lib'))('@electron/asar');
  const packaged = JSON.parse(
    asar.extractFile(join(bundle, 'Contents/Resources/app.asar'), 'package.json').toString(),
  );
  assert.equal(packaged.delaMacUpdates, true, '候选包缺少更新标记');
  assert.match(process.env.APPLE_TEAM_ID || '', /^[A-Z0-9]{10}$/);
  for (const path of [
    bundle,
    ...['rg', 'fd'].map((name) => join(bundle, 'Contents/Resources/bin/darwin-arm64', name)),
  ]) {
    execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', path], { stdio: 'pipe' });
    const result = spawnSync('/usr/bin/codesign', ['--display', '--verbose=4', path], {
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, '无法读取签名');
    assert.ok(
      result.stderr.includes(`TeamIdentifier=${process.env.APPLE_TEAM_ID}\n`),
      '签名 Team ID 不匹配',
    );
    assert.ok(
      result.stderr.includes('Authority=Developer ID Application:'),
      '必须使用 Developer ID Application 签名',
    );
  }
  execFileSync('/usr/bin/xcrun', ['stapler', 'validate', bundle], { stdio: 'inherit' });
  execFileSync('/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose=2', bundle], {
    stdio: 'inherit',
  });
  console.log('Mac 候选包签名、公证及更新文件校验通过；尚不代表两版升级验收通过。');
}
