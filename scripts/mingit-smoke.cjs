// MinGit 一键安装冒烟：真实下载 → SHA256 校验 → 解压 → 复制 bash → rcfile 启动装好的
// bash 并确认 git 可用，最后经应用 IPC 建一个真实终端。系统探测候选被指向沙箱目录，
// 强制走 MinGit 分支（只影响本进程）；全部产物装进沙箱，结束时清理。约需下载 40MB。
const { app } = require('electron');
const { spawnSync } = require('node:child_process');
const { existsSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const assert = require('node:assert/strict');

const root = resolve(process.argv[2] || '.');
const sandbox = mkdtempSync(join(tmpdir(), 'dela-mingit-smoke-'));
process.env.ProgramFiles = sandbox;
process.env['ProgramFiles(x86)'] = sandbox;
process.env.LOCALAPPDATA = sandbox;
// 随包候选一并指进沙箱：本地打过包后 .build/mingit 存在，不隔离会跳过安装分支。
process.env.DELA_DEV_MINGIT = join(sandbox, 'bundled');
app.setPath('userData', join(sandbox, 'userdata'));
app.setPath('documents', join(sandbox, 'userdata'));

const mingitBash = join(sandbox, 'Dela', 'mingit', 'v2.56.0.2', 'usr', 'bin', 'bash.exe');

app.once('browser-window-created', (_event, window) => {
  window.webContents.setBackgroundThrottling(false);
  window.webContents.once('did-finish-load', () => {
    void run(window.webContents)
      .then(() => app.quit())
      .catch((error) => {
        console.error(error);
        app.exit(1);
      });
  });
});
app.on('will-quit', () => {
  try {
    rmSync(sandbox, { recursive: true, force: true, maxRetries: 5 });
  } catch {
    // 终端进程短暂持有文件锁时留待系统清理临时目录。
  }
});
require(join(root, 'out/main/index.cjs'));

async function run(contents) {
  const js = (source) => contents.executeJavaScript(source);
  for (let until = Date.now() + 10_000; ;) {
    if (await js('!!window.dela?.terminal')) break;
    if (Date.now() > until) throw new Error('preload 桥未就绪');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  const status = await js('window.dela.terminal.bashStatus()');
  assert.equal(status.found, false, '沙箱下不应探测到系统 Git Bash');

  await js(`(async () => {
    window.__mingitPhases = [];
    window.dela.terminal.onBashInstall((snapshot) => window.__mingitPhases.push(snapshot.phase));
    window.__mingitInstall = window.dela.terminal.installBash();
  })()`);
  const installed = await js('window.__mingitInstall');
  assert.equal(installed.install.phase, 'done');
  assert.equal(installed.found, true);
  const phases = await js('window.__mingitPhases');
  assert.ok(
    phases.includes('downloading') && phases.includes('extracting'),
    `阶段推送不全：${phases}`,
  );
  assert.ok(existsSync(mingitBash), '安装后 bash.exe 应就位');

  const rc = join(sandbox, 'rc');
  writeFileSync(rc, 'echo SMOKE_RC_OK git_type=$(type -t git) bashver=$BASH_VERSION\n');
  const shell = spawnSync(mingitBash, ['--noprofile', '--rcfile', rc, '-i'], {
    input: 'exit\r',
    encoding: 'utf8',
    timeout: 15_000,
  });
  assert.match(shell.stdout, /SMOKE_RC_OK/, 'rcfile 未生效');
  assert.match(shell.stdout, /git_type=file/, 'MinGit 的 git 不在 PATH');
  assert.match(shell.stdout, /bashver=\d/, '不是完整的 bash');

  const project = await js(
    `window.dela.workspace.create({ parentId: null, name: 'MinGit 冒烟', kind: 'project' })`,
  );
  const session = await js(`window.dela.terminal.create('${project.id}', crypto.randomUUID())`);
  assert.equal(session.title, 'Git Bash');
  console.log('MinGit smoke OK:', phases.join(' → '));
}
