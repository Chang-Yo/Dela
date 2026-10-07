// Bash（Git Bash）：简单命令执行、cwd 语义、长任务让出/续读/取消、dela 命令桥回环。
// 真实 commands.ts（桥 → 领域命令）与真实 Git Bash（locateBash）。
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

const state = vi.hoisted(() => ({ root: '' }));
vi.mock('electron', () => ({ app: { getPath: () => state.root } }));
import { closeDatabase, getDatabase } from '../../../../database';
import { bashTool } from '../bash';

let cwd = '';

beforeAll(() => {
  state.root = mkdtempSync(join(tmpdir(), 'dela-bash-'));
  cwd = mkdtempSync(join(tmpdir(), 'dela-bash-cwd-'));
  getDatabase();
});

afterAll(() => {
  closeDatabase();
  rmSync(state.root, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

interface BashResult {
  taskId: string;
  running: boolean;
  exitCode: number | null;
  output: string;
}

function run(input: Record<string, unknown>) {
  return bashTool.execute(input, { cwd }) as Promise<BashResult>;
}

describe('bashTool', () => {
  it('执行简单命令并返回输出与退出码', async () => {
    const result = await run({ command: 'echo dela-bash-ok' });
    expect(result.output).toContain('dela-bash-ok');
    expect(result.running).toBe(false);
    expect(result.exitCode).toBe(0);
  });

  it('cwd 默认取工具上下文（项目目录）', async () => {
    const result = await run({ command: 'pwd' });
    // Git Bash 的 pwd 是 /c/... 形式，比较目录名。
    expect(result.output).toContain(basename(cwd));
  });

  it('长任务让出返回 taskId，续读拿到后续输出', async () => {
    const yielded = await run({ command: 'sleep 1.2; echo late-output', yieldMs: 200 });
    expect(yielded.running).toBe(true);
    expect(typeof yielded.taskId).toBe('string');
    const finished = await run({ taskId: yielded.taskId, waitMs: 8000 });
    expect(finished.running).toBe(false);
    expect(finished.output).toContain('late-output');
    expect(finished.exitCode).toBe(0);
  });

  it('cancel 停止运行中的任务', async () => {
    const yielded = await run({ command: 'sleep 30', yieldMs: 200 });
    expect(yielded.running).toBe(true);
    const cancelled = await run({ taskId: yielded.taskId, cancel: true, waitMs: 5000 });
    expect(cancelled.running).toBe(false);
    expect(cancelled.exitCode).not.toBe(0);
  });

  it('dela 命令桥在 shell 内可用（dela help 返回命令清单）', async () => {
    const result = await run({ command: 'dela help', yieldMs: 10000 });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('read_resource');
  });
});
