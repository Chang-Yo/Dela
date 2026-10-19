// 在目标架构的 Mac 上检查目录包与同版本 DMG/ZIP（--dir 仅检查目录包）；只读，不安装或启动应用。
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

assert.equal(process.platform, 'darwin', '请在 macOS 上验证 Mac 产物');
assert.equal(process.arch, 'arm64', 'macOS 仅支持 Apple Silicon');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bundle = resolve(process.argv[2] || join(root, 'dist', 'mac-arm64', 'Dela.app'));
const resources = join(bundle, 'Contents', 'Resources');
const signed = process.argv.includes('--signed');
const teamId = process.env.APPLE_TEAM_ID || '';
if (signed) assert.match(teamId, /^[A-Z0-9]{10}$/, '--signed 需要 APPLE_TEAM_ID');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

function verifySignedBundle(path: string) {
  let bundleHash = '';
  for (const executable of [
    path,
    ...['rg', 'fd'].map((name) => join(path, 'Contents/Resources/bin/darwin-arm64', name)),
  ]) {
    execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', executable], {
      stdio: 'pipe',
    });
    const result = spawnSync('/usr/bin/codesign', ['--display', '--verbose=4', executable], {
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, '无法读取签名');
    assert.ok(result.stderr.includes(`TeamIdentifier=${teamId}\n`), '签名 Team ID 不匹配');
    assert.match(result.stderr, /^Authority=Developer ID Application:/m);
    assert.match(result.stderr, /^Timestamp=.+/m);
    assert.match(result.stderr, /flags=.*\bruntime\b/);
    if (executable === path) {
      bundleHash = /^CDHash=([a-f0-9]+)$/m.exec(result.stderr)?.[1] || '';
      assert.ok(bundleHash, '缺少应用签名摘要');
    }
  }
  execFileSync('/usr/bin/xcrun', ['stapler', 'validate', path], { stdio: 'inherit' });
  execFileSync('/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose=2', path], {
    stdio: 'inherit',
  });
  return bundleHash;
}

const plist = (key: string) =>
  execFileSync(
    '/usr/libexec/PlistBuddy',
    ['-c', `Print :${key}`, join(bundle, 'Contents/Info.plist')],
    {
      encoding: 'utf8',
    },
  ).trim();
assert.equal(plist('CFBundleIdentifier'), 'io.dela.desktop');
assert.equal(plist('CFBundleShortVersionString'), version);
assert.equal(plist('LSApplicationCategoryType'), 'public.app-category.productivity');
assert.equal(
  execFileSync('/usr/bin/lipo', ['-archs', join(bundle, 'Contents/MacOS/Dela')], {
    encoding: 'utf8',
  }).trim(),
  'arm64',
);
assert.ok(existsSync(join(resources, 'app.asar')), '缺少应用代码');
const bundleHash = signed ? verifySignedBundle(bundle) : null;
for (const name of ['openssh', 'mingit', 'app-update.yml']) {
  assert.ok(!existsSync(join(resources, name)), `Mac 产物不应包含 ${name}`);
}
const expectedTools = [`darwin-${process.arch}`];
const licenses = readdirSync(join(root, 'vendor/bin')).filter((name) =>
  name.startsWith('LICENSE-'),
);
assert.deepEqual(
  readdirSync(join(resources, 'bin')).sort(),
  [...expectedTools, ...licenses, 'README.md'].sort(),
);
for (const name of ['rg', 'fd']) {
  const relative = join('bin', `darwin-${process.arch}`, name);
  const executable = join(resources, relative);
  // Developer ID 签名会改变 Mach-O 字节；签名包在执行工具前校验签名和 Team ID。
  if (!signed)
    assert.deepEqual(readFileSync(executable), readFileSync(join(root, 'vendor', relative)));
  assert.ok(statSync(executable).mode & 0o111, `${name} 不可执行`);
  execFileSync(executable, ['--version'], { timeout: 5000, stdio: 'pipe' });
}
for (const name of [...licenses, 'README.md']) {
  assert.deepEqual(
    readFileSync(join(resources, 'bin', name)),
    readFileSync(join(root, 'vendor/bin', name)),
  );
}
for (const arch of ['amd64', 'arm64']) {
  const name = `dela-helper-linux-${arch}`;
  assert.deepEqual(
    readFileSync(join(resources, 'dela-helper', name)),
    readFileSync(join(root, 'vendor/dela-helper', name)),
  );
}
if (!process.argv.includes('--dir')) {
  const prefix = join(resolve(bundle, '../..'), `Dela-${version}-mac-${process.arch}`);
  for (const extension of ['dmg', 'zip']) assert.ok(statSync(`${prefix}.${extension}`).size > 0);
  execFileSync('/usr/bin/hdiutil', ['verify', '-quiet', `${prefix}.dmg`], {
    timeout: 120000,
    stdio: 'inherit',
  });
  execFileSync('/usr/bin/unzip', ['-tq', `${prefix}.zip`], { timeout: 120000, stdio: 'inherit' });
  if (signed) {
    const directory = mkdtempSync(join(tmpdir(), 'dela-signed-archives-'));
    const mount = join(directory, 'dmg');
    try {
      execFileSync('/usr/bin/ditto', ['-x', '-k', `${prefix}.zip`, join(directory, 'zip')], {
        timeout: 120000,
        stdio: 'pipe',
      });
      assert.equal(
        verifySignedBundle(join(directory, 'zip', 'Dela.app')),
        bundleHash,
        'ZIP 内的应用与目录包不一致',
      );
      execFileSync(
        '/usr/bin/hdiutil',
        ['attach', '-readonly', '-nobrowse', '-mountpoint', mount, `${prefix}.dmg`],
        { timeout: 120000, stdio: 'pipe' },
      );
      try {
        assert.equal(
          verifySignedBundle(join(mount, 'Dela.app')),
          bundleHash,
          'DMG 内的应用与目录包不一致',
        );
      } finally {
        execFileSync('/usr/bin/hdiutil', ['detach', mount], { timeout: 30000, stdio: 'pipe' });
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
}
console.log(
  process.argv.includes('--dir')
    ? 'macOS directory package verified: identity, resources, licenses and tools.'
    : 'macOS package verified: identity, resources, licenses, tools, DMG and ZIP integrity.',
);
