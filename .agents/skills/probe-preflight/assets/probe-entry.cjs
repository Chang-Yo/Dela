// Electron 一次性入口：隔离 userData 后加载真实主进程 bundle。
// 用法：electron probe-entry.cjs <profile目录>（配合驱动脚本的 spawn 使用）
const { app } = require('electron');
const path = require('node:path');

app.setPath('userData', process.argv[2]);
// TODO(probe): 按需改为 require('<仓库>/out/main/index.cjs') 加载真实应用，
// 或在种子场景中直接操作 better-sqlite3（Electron 运行时内，ABI 才匹配）。
require(path.join(__dirname, '..', 'out', 'main', 'index.cjs'));
