// 打包前准备随包 MinGit 运行时：版本、SHA256 与下载源只在 src/main/terminal/mingit.ts 定义，
// 这里解析同一份定义（换版本必须成对更新），产物到 .build/mingit，仓库不提交这约 40MB。
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

if (process.platform === 'darwin') {
  console.log('macOS 使用系统 Bash / Git 与 vendor/bin 下的对应架构搜索工具，无需 MinGit。');
  process.exit(0);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, '.build', 'mingit');
const marker = join(root, '.build', 'mingit.prepared');

const source = readFileSync(join(root, 'src', 'main', 'terminal', 'mingit.ts'), 'utf8');
const version = /MINGIT_VERSION = '([^']+)'/.exec(source)?.[1];
const sha256 = /MINGIT_SHA256 = '([0-9a-f]{64})'/.exec(source)?.[1];
const urls = [...source.matchAll(/'(https:\/\/[^']*MinGit-[^']*\.zip)'/g)].map(
  (match) => match[1]!,
);
if (!version || !sha256 || urls.length < 2) {
  console.error('无法从 src/main/terminal/mingit.ts 解析 MinGit 版本定义，请检查常量拼写。');
  process.exit(1);
}

// 已为同一版本准备过就直接跳过：本地连续打 dir/dist 包不重复下载。
const fingerprint = `${version} ${sha256}`;
if (
  existsSync(marker) &&
  readFileSync(marker, 'utf8').trim() === fingerprint &&
  existsSync(join(outDir, 'usr', 'bin', 'bash.exe'))
) {
  console.log(`MinGit ${version} 已就绪，跳过下载。`);
  process.exit(0);
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
const archive = join(outDir, 'mingit.zip');
const failures: string[] = [];
let downloaded = false;
for (const url of urls) {
  try {
    console.log(`下载 ${url}`);
    const response = await fetch(url, { redirect: 'follow' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (!response.body) throw new Error('下载没有返回内容');
    const hash = createHash('sha256');
    await pipeline(
      Readable.fromWeb(response.body),
      async function* (chunks) {
        for await (const chunk of chunks) {
          hash.update(chunk);
          yield chunk;
        }
      },
      createWriteStream(archive),
    );
    const actual = hash.digest('hex');
    if (actual !== sha256) throw new Error(`SHA256 不符（${actual.slice(0, 12)}…）`);
    downloaded = true;
    break;
  } catch (cause) {
    failures.push(`${new URL(url).host}：${cause instanceof Error ? cause.message : cause}`);
    rmSync(archive, { force: true });
  }
}
if (!downloaded) {
  console.error(`下载失败（${failures.join('；')}）`);
  process.exit(1);
}

// 与运行时一键安装同一条解压路径：Windows 10 1803+ 自带的 bsdtar。
const tar = join(process.env.windir ?? 'C:\\Windows', 'System32', 'tar.exe');
const extract = spawnSync(tar, ['-xf', archive, '-C', outDir], { stdio: 'inherit' });
if (extract.status !== 0) process.exit(extract.status ?? 1);
rmSync(archive, { force: true });

// MinGit 的 bash 本体以 sh.exe 名义分发；复制出 bash.exe 才走完整 bash 模式（同运行时安装）。
copyFileSync(join(outDir, 'usr', 'bin', 'sh.exe'), join(outDir, 'usr', 'bin', 'bash.exe'));
for (const must of [join('usr', 'bin', 'bash.exe'), join('cmd', 'git.exe')]) {
  if (!existsSync(join(outDir, must))) {
    console.error(`解压结果缺少 ${must}`);
    process.exit(1);
  }
}
mkdirSync(dirname(marker), { recursive: true });
writeFileSync(marker, fingerprint);
console.log(`MinGit ${version} 已就绪：${outDir}`);
