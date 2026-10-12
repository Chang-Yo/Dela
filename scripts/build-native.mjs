#!/usr/bin/env node
// 构建商店更新原生模块（native/store-update），产出 out/native/store_update.node。
//
// 依赖：Visual Studio 2022 生成工具（含「使用 C++ 的桌面开发」）与 Windows 10/11 SDK。
// C++/WinRT 的投影头文件随 SDK 提供，不需要额外下载。
//
// 这个脚本单独于 `pnpm build`：它需要 MSVC，而 `pnpm build` 在只装了 Node 的机器上
// 必须仍然能跑。打包脚本（package:dir / package:dist）会先跑它。
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const addonDir = join(root, 'native', 'store-update');
const outputDir = join(root, 'out', 'native');
const artifact = 'store_update.node';

/** 找到带 C++/WinRT 投影头文件的最高版本 Windows SDK。 */
function findCppWinrtInclude() {
  const candidates = [
    process.env.WindowsSdkDir && join(process.env.WindowsSdkDir, 'Include'),
    'C:\\Program Files (x86)\\Windows Kits\\10\\Include',
  ].filter(Boolean);
  for (const base of candidates) {
    if (!existsSync(base)) continue;
    const versions = readdirSync(base).sort((a, b) => b.localeCompare(a, 'en', { numeric: true }));
    for (const version of versions) {
      const include = join(base, version, 'cppwinrt');
      if (existsSync(join(include, 'winrt', 'Windows.Services.Store.h'))) return include;
    }
  }
  return null;
}

const winrtInclude = findCppWinrtInclude();
if (!winrtInclude) {
  console.error(
    '找不到 Windows SDK 的 C++/WinRT 头文件（Include\\<版本>\\cppwinrt\\winrt\\Windows.Services.Store.h）。\n' +
      '请安装 Windows 10/11 SDK 后重试，或设置 WindowsSdkDir 指向 Windows Kits\\10。',
  );
  process.exit(1);
}

const nodeGyp = join(root, 'node_modules', 'node-gyp', 'bin', 'node-gyp.js');
if (!existsSync(nodeGyp)) {
  console.error('找不到 node-gyp，请先运行 pnpm install。');
  process.exit(1);
}

console.log(`C++/WinRT 头文件：${winrtInclude}`);
const build = spawnSync(process.execPath, [nodeGyp, 'rebuild'], {
  cwd: addonDir,
  // 用 inherit 而不是管道：构建日志直接进终端，也避免受限环境下管道被拒。
  stdio: 'inherit',
  env: { ...process.env, DELA_WINRT_INCLUDE: winrtInclude },
});
if (build.error) throw build.error;
if (build.status !== 0) process.exit(build.status ?? 1);

const built = join(addonDir, 'build', 'Release', artifact);
if (!existsSync(built)) {
  console.error(`构建结束但没有产物：${built}`);
  process.exit(1);
}
mkdirSync(outputDir, { recursive: true });
copyFileSync(built, join(outputDir, artifact));
console.log(`已产出 out/native/${artifact}`);
