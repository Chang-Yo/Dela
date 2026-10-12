// 构建远端 helper：默认 linux/amd64，`--all` 同时出 linux/arm64。
// CGO_ENABLED=0 保证静态链接（glibc 与 musl 通吃），-trimpath 不把本机路径带进二进制。
// 产物放 vendor/dela-helper/，随 Dela 一起分发并上传到远端（见 helper/README.md）。
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'vendor', 'dela-helper');
const targets = process.argv.includes('--all')
  ? [
      ['linux', 'amd64'],
      ['linux', 'arm64'],
    ]
  : [['linux', 'amd64']];

const probe = spawnSync('go', ['version'], { encoding: 'utf8' });
if (probe.status !== 0) {
  console.error('找不到 go：请先安装 Go 工具链并让它出现在 PATH 上。');
  process.exit(1);
}
console.log(probe.stdout.trim());

mkdirSync(outDir, { recursive: true });
for (const [goos, goarch] of targets) {
  const name = `dela-helper-${goos}-${goarch}`;
  const out = join(outDir, name);
  const build = spawnSync('go', ['build', '-trimpath', '-ldflags', '-s -w', '-o', out, './'], {
    cwd: join(root, 'helper'),
    encoding: 'utf8',
    env: { ...process.env, GOOS: goos, GOARCH: goarch, CGO_ENABLED: '0' },
  });
  if (build.status !== 0) {
    console.error(build.stdout, build.stderr);
    process.exit(1);
  }
  const bytes = readFileSync(out);
  const digest = createHash('sha256').update(bytes).digest('hex');
  console.log(`${name}  ${statSync(out).size} 字节  sha256=${digest.slice(0, 16)}…  ${digest}`);
}
