import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// 真机远程套件：只跑 *.remote.test.ts，需要 DELA_REMOTE_HOST（如 root@1.2.3.4）。
// 默认的 vitest.config.ts 把它们排除在外——CI 没有可连的主机，跳过等于没覆盖，
// 但白导入 Pi、白建临时目录的代价照付。
export default defineConfig({
  resolve: { alias: { '@': resolve('src/renderer') } },
  test: {
    include: ['src/**/*.remote.test.ts'],
    globalSetup: ['src/main/remotes/test/remote-host.setup.ts'],
    // 逐个文件串行：几套用例共用同一台主机上的 helper 通道与临时目录，
    // 并行跑会互相 closeHelper、抢 /tmp 下的固定路径。
    fileParallelism: false,
    // 真机来回一次就是几百毫秒，单个用例自己声明的超时更宽松。
    testTimeout: 240_000,
  },
});
