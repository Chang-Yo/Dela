// dela 命令桥：bash 函数把参数逐个以 NUL 分隔后经 stdin 交给 curl。
// 两条回归：参数原样到达服务端（不被 shell 截断）；非 ASCII 内容经真实 curl 与端口后仍是 UTF-8。
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  ipcMain: {},
  app: { getPath: () => tmpdir(), isPackaged: false, getAppPath: () => tmpdir() },
}));
vi.mock('node-pty', () => ({ spawn: vi.fn() }));
import { COMMAND_BRIDGE } from '../commands';
import { locateBash } from '../../terminal';

/** 把请求体写进文件而不真的发请求；只认桥当前使用的 --data-binary。 */
const CURL_STUB =
  'curl() { while [ "$#" -gt 0 ]; do [ "$1" = "--data-binary" ] && cat > "$DELA_CAPTURE"; shift; done; }\n';

/** 在临时目录写入脚本，环境和行由调用方拼好。 */
function writeScript(prefix: string, env: string, line: string) {
  const directory = mkdtempSync(join(tmpdir(), `dela-bridge-${prefix}-`));
  const path = join(directory, 'run.sh');
  writeFileSync(path, `${env}\n${COMMAND_BRIDGE}\n${line}`);
  return { directory, path };
}

/** 执行一行 dela 调用，返回 curl 收到的 NUL 分隔参数。 */
function bridgeArgv(line: string) {
  const capture = join(tmpdir(), `dela-bridge-capture-${process.pid}-${Date.now()}.bin`);
  const { directory, path } = writeScript(
    'stub',
    `export DELA_COMMAND_URL='http://127.0.0.1:9/' DELA_COMMAND_TOKEN=t DELA_CAPTURE='${capture.replace(/\\/g, '/')}'\n${CURL_STUB}`,
    line,
  );
  try {
    const run = spawnSync(locateBash(), [path], { encoding: 'utf8' });
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
    return readFileSync(capture, 'utf8').split('\0').slice(0, -1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
    rmSync(capture, { force: true });
  }
}

/** 用真实 curl 把一行 dela 调用发到本机端口，返回服务端收到的 NUL 分隔参数。 */
async function postedArgv(port: number, line: string) {
  const { directory, path } = writeScript(
    'curl',
    `export DELA_COMMAND_URL='http://127.0.0.1:${port}/' DELA_COMMAND_TOKEN=t`,
    line,
  );
  try {
    // 异步执行：同步阻塞会让同进程的 HTTP 服务端无法应答。
    const child = spawn(locateBash(), [path], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    await new Promise((resolve) => child.on('close', resolve));
    expect(stderr).toBe('');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe('dela 命令桥', () => {
  it('参数逐个按 NUL 分隔递出，不经 bash 重组', () => {
    expect(bridgeArgv('dela todo save --title 交作业 --completed')).toEqual([
      'todo',
      'save',
      '--title',
      '交作业',
      '--completed',
    ]);
    expect(bridgeArgv('dela help')).toEqual(['help']);
    expect(bridgeArgv('dela todo query')).toEqual(['todo', 'query']);
  });

  // 走真实 curl 和本机端口，覆盖整条 argv → HTTP 的路径。Windows 上按 ANSI 代码页转码的问题
  // 只在这段路上暴露，桩函数拿不到 argv 转换，因此必须打真实端口。
  it('非 ASCII 参数经端口送达时原样保留', async () => {
    const samples = ['社团活动', '日本語テスト', '重要🎌【全角】', 'Lab 报告 第3次'];
    const bodies: string[][] = [];
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        bodies.push(Buffer.concat(chunks).toString('utf8').split('\0').slice(0, -1));
        response.end('{"ok":true}');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    try {
      for (const title of samples) await postedArgv(port, `dela todo save --title '${title}'`);
    } finally {
      server.close();
    }

    expect(bodies).toEqual(samples.map((title) => ['todo', 'save', '--title', title]));
  });
});
