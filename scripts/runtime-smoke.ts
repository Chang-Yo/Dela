// 直接执行 Pi 的本地工具与真实 dela 命令桥，不调用模型或真实校园接口。
import { app } from 'electron';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { locateBash } from '../src/main/terminal';
import { prependRuntimePath } from '../src/main/terminal/mingit';
import { locateSsh } from '../src/main/remotes/transport';
import { loadPi } from '../src/main/agent/pi';
import { closeDomainBridge, domainBridge } from '../src/main/agent/environment';
import { COMMAND_BRIDGE } from '../src/main/agent/commands';
import { closeDatabase } from '../src/main/database';

const root = resolve('.');
const profile = mkdtempSync(join(tmpdir(), 'dela-runtime-中文-'));
app.setAppPath(root);
for (const name of ['userData', 'documents', 'home'] as const) app.setPath(name, profile);
// 隔离 Pi 的二进制缓存，禁用缺少工具时的联网下载，确保测试命中随包工具。
process.env.PI_CODING_AGENT_DIR = join(profile, 'pi');
process.env.PI_OFFLINE = '1';
if (process.platform === 'darwin') process.env.PATH = '/usr/bin:/bin';

const text = (result: { content: { type: string; text?: string }[]; isError?: boolean }) => {
  assert.notEqual(result.isError, true);
  return result.content
    .filter((item) => item.type === 'text')
    .map((item) => item.text)
    .join('\n');
};
const timeout = setTimeout(() => app.exit(1), 30000);
app.whenReady().then(async () => {
  let exitCode = 1;
  try {
    prependRuntimePath();
    const tools = join(
      root,
      'vendor',
      'bin',
      ...(process.platform === 'darwin' ? [`darwin-${process.arch}`] : []),
    );
    const separator = process.platform === 'win32' ? ';' : ':';
    assert.equal(process.env.PATH!.split(separator)[0], tools);
    for (const tool of ['rg', 'fd']) {
      const found = execFileSync(
        process.platform === 'win32' ? 'where' : '/usr/bin/which',
        [tool],
        { encoding: 'utf8' },
      )
        .trim()
        .split(/\r?\n/)[0];
      assert.equal(found, join(tools, `${tool}${process.platform === 'win32' ? '.exe' : ''}`));
    }
    execFileSync(locateSsh(), ['-V'], { stdio: 'pipe', timeout: 5000 });
    const bridge = await domainBridge();
    const pi = await loadPi();
    const bash = pi.createBashTool(profile, {
      shellPath: locateBash(),
      commandPrefix: `export DELA_COMMAND_URL='${bridge.url}' DELA_COMMAND_TOKEN='${bridge.token}'\n${COMMAND_BRIDGE}`,
    });
    const response = JSON.parse(
      text(await bash.execute('smoke-bash', { command: 'dela help', timeout: 5 })),
    );
    assert.equal(response.ok, true);
    assert.ok(response.result.some((command: { name: string }) => command.name === 'query_todos'));
    writeFileSync(join(profile, 'fixture 测试.txt'), 'dela-runtime-needle 中文\n');
    assert.match(
      text(
        await pi.createGrepTool(profile).execute('smoke-grep', { pattern: 'dela-runtime-needle' }),
      ),
      /dela-runtime-needle/,
    );
    assert.match(
      text(await pi.createFindTool(profile).execute('smoke-find', { pattern: '*.txt' })),
      /fixture 测试\.txt/,
    );
    console.log(
      'Runtime smoke passed: platform Bash/SSH, bundled rg/fd, Pi bash/grep/find, real dela help bridge.',
    );
    exitCode = 0;
  } catch (error) {
    console.error(error);
  } finally {
    clearTimeout(timeout);
    closeDomainBridge();
    closeDatabase();
    // Windows 上 Chromium 退出前一直占着 userData 里的着色器缓存，目录留给系统临时目录回收。
    if (process.platform !== 'win32') rmSync(profile, { recursive: true, force: true });
    app.exit(exitCode);
  }
});
