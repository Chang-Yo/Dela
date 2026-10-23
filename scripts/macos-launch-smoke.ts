// 经 LaunchServices 启动真实 .app：脱离仓库工作目录与开发 PATH，使用应用自带的隔离冒烟模式。
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

assert.equal(process.platform, 'darwin', '请在 macOS 上运行');
assert.ok(process.argv[2], '请传入 Dela.app 路径');
const bundle = resolve(process.argv[2]);
const directory = mkdtempSync(join(tmpdir(), 'dela-launch-smoke-'));
const stdout = join(directory, 'stdout.log');
const stderr = join(directory, 'stderr.log');
try {
  // 60 秒：公证过的包首启要过 Gatekeeper 评估（OCSP 校验 + 全包扫描），CI 虚拟机上可能明显慢于本地。
  execFileSync(
    '/usr/bin/open',
    [
      '-n',
      '-W',
      '-g',
      '--stdout',
      stdout,
      '--stderr',
      stderr,
      '--env',
      'PATH=/usr/bin:/bin:/usr/sbin:/sbin',
      '-a',
      bundle,
      '--args',
      '--smoke-test',
    ],
    { cwd: directory, timeout: 60_000, stdio: 'pipe' },
  );
  const output = readFileSync(stdout, 'utf8');
  // open 的退出码只代表启动请求成功，必须由应用自身报告冒烟通过。
  assert.ok(
    output.includes(
      'Smoke check passed: SQLite, renderer, preload isolation, Agent runtime (ESM).',
    ),
    `应用没有报告通过：\n${output}\n${readFileSync(stderr, 'utf8')}`,
  );
  console.log('macOS LaunchServices smoke passed: packaged app, external cwd, system PATH.');
} finally {
  rmSync(directory, { recursive: true, force: true });
}
