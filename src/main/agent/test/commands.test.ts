// dela 命令桥 bash 函数：在真实 Git Bash 里执行 COMMAND_BRIDGE，用 curl 桩捕获
// --data 实际收到的请求体，验证 '<JSON>' 参数原样进入 input。
// 回归：\${2:-{}} 会被 bash 截断在第一个 }，再拼出一个字面量 } 使 JSON 非法。
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ ipcMain: {}, app: { getPath: () => tmpdir() } }));
vi.mock('node-pty', () => ({ spawn: vi.fn() }));
import { COMMAND_BRIDGE } from '../commands';
import { locateBash } from '../../terminal';

/** 执行 `dela <line>`，返回 curl 桩捕获到的 --data JSON。 */
function bridgeBody(line: string) {
  const directory = mkdtempSync(join(tmpdir(), 'dela-bridge-'));
  try {
    const capture = join(directory, 'capture.json').replace(/\\/g, '/');
    const script =
      `export DELA_COMMAND_URL='http://127.0.0.1:9/' DELA_COMMAND_TOKEN=t DELA_CAPTURE='${capture}'\n` +
      'curl() { while [ "$#" -gt 0 ]; do [ "$1" = "--data" ] && printf \'%s\' "$2" > "$DELA_CAPTURE"; shift; done; }\n' +
      COMMAND_BRIDGE +
      `\ndela ${line}`;
    const path = join(directory, 'run.sh');
    writeFileSync(path, script);
    const run = spawnSync(locateBash(), [path], { encoding: 'utf8' });
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
    return JSON.parse(readFileSync(join(directory, 'capture.json'), 'utf8'));
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
});
