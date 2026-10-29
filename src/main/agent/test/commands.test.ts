// dela 命令桥 bash 函数：在真实 Git Bash 里执行 COMMAND_BRIDGE。
// 两条回归：'<JSON>' 参数原样进入 input（\${2:-{}} 会被 bash 截断在第一个 } 再拼出字面量 }）；
// 请求体经 stdin 递出，走 argv 时 Windows 会按 ANSI 代码页转码，非 ASCII 内容到端上已是替换字符。
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
  writeFileSync(path, `${env}\n${COMMAND_BRIDGE}\ndela ${line}`);
  return { directory, path };
}

/** 执行 `dela <line>`，返回 curl 桩捕获到的请求体 JSON。 */
function bridgeBody(line: string) {
  const capture = join(tmpdir(), `dela-bridge-capture-${process.pid}-${Date.now()}.json`);
  const { directory, path } = writeScript(
    'stub',
    `export DELA_COMMAND_URL='http://127.0.0.1:9/' DELA_COMMAND_TOKEN=t DELA_CAPTURE='${capture.replace(/\\/g, '/')}'\n${CURL_STUB}`,
    line,
  );
  try {
    const run = spawnSync(locateBash(), [path], { encoding: 'utf8' });
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
    return JSON.parse(readFileSync(capture, 'utf8'));
  } finally {
    rmSync(directory, { recursive: true, force: true });
    rmSync(capture, { force: true });
  }
}

/** 用真实 curl 把 `dela <line>` 发到本机端口，返回端口收到的请求体。 */
async function postedBody(port: number, line: string) {
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
  it("把 '<JSON>' 原样作为 input 发送，缺省为 {}", () => {
    expect(bridgeBody('help')).toEqual({ command: 'help', input: {} });
    expect(bridgeBody("todo_list '{}'")).toEqual({ command: 'todo_list', input: {} });
    expect(bridgeBody('todo_search \'{"query":"x"}\'')).toEqual({
      command: 'todo_search',
      input: { query: 'x' },
    });
  });

  // 走真实 curl 和本机端口，覆盖整条 argv → HTTP 的路径。Windows 上按 ANSI 代码页转码的问题
  // 只在这段路上暴露，桩函数拿不到 argv 转换，因此必须打真实端口。
  it('非 ASCII 标题经端口送达时原样保留', async () => {
    const samples = ['社团活动', '日本語テスト', '重要🎌【全角】', 'Lab 报告 第3次'];
    const bodies: string[] = [];
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        bodies.push(Buffer.concat(chunks).toString('utf8'));
        response.end('{"ok":true}');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    try {
      for (const title of samples) await postedBody(port, `create_event '{"title":"${title}"}'`);
    } finally {
      server.close();
    }

    expect(bodies.map((body) => JSON.parse(body).input.title)).toEqual(samples);
  });
});
