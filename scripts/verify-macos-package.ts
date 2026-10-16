// 在目标架构的 Mac 上检查目录包与同版本 DMG/ZIP；只读，不安装或启动应用。
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

assert.equal(process.platform, 'darwin', '请在 macOS 上验证 Mac 产物');
assert.equal(process.arch, 'arm64', 'macOS 仅支持 Apple Silicon');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bundle = resolve(process.argv[2] || join(root, 'dist', 'mac-arm64', 'Dela.app'));
const resources = join(bundle, 'Contents', 'Resources');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
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
const prefix = join(root, 'dist', `Dela-${version}-mac-${process.arch}`);
for (const extension of ['dmg', 'zip']) assert.ok(statSync(`${prefix}.${extension}`).size > 0);
execFileSync('/usr/bin/hdiutil', ['verify', '-quiet', `${prefix}.dmg`], {
  timeout: 120000,
  stdio: 'inherit',
});
execFileSync('/usr/bin/unzip', ['-tq', `${prefix}.zip`], { timeout: 120000, stdio: 'inherit' });
console.log(
  `macOS package verified (${process.arch}): identity, resources, licenses, tools, DMG and ZIP integrity.`,
);
