// macOS 第一阶段：独立临时目录、合成数据；验证依赖，不代表产品终端已适配。
const { app, safeStorage } = require('electron');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { createRequire } = require('node:module');
const { join, resolve } = require('node:path');
// 可传 app.asar 路径，检查打包后的原生依赖；Electron 宿主仍为执行此脚本的运行时。
const requireNative = createRequire(
  join(resolve(process.argv[2] || join(__dirname, '..')), 'package.json'),
);

if (process.platform !== 'darwin') {
  console.error('smoke:macos 仅在 macOS 上运行。');
  app.exit(1);
} else {
  const profile = mkdtempSync(join(tmpdir(), 'dela-macos-smoke-'));
  app.setPath('userData', profile);
  const timeout = setTimeout(() => {
    console.error('macOS smoke timed out');
    app.exit(1);
  }, 15000);

  app.whenReady().then(async () => {
    let exitCode = 1;
    try {
      const Database = requireNative('better-sqlite3');
      const db = new Database(join(profile, 'smoke.db'));
      try {
        db.exec('CREATE TABLE smoke (value TEXT NOT NULL)');
        db.prepare('INSERT INTO smoke VALUES (?)').run('macOS 验证');
        assert.equal(db.prepare('SELECT value FROM smoke').get().value, 'macOS 验证');
      } finally {
        db.close();
      }

      assert.ok(safeStorage.isEncryptionAvailable(), 'Keychain encryption unavailable');
      const sample = 'dela-macos-smoke 合成数据';
      assert.equal(safeStorage.decryptString(safeStorage.encryptString(sample)), sample);

      for (const [tool, args] of [
        ['/usr/bin/git', ['--version']],
        ['/usr/bin/ssh', ['-V']],
        ['/usr/bin/curl', ['--version']],
      ]) {
        execFileSync(tool, args, { timeout: 5000, stdio: 'pipe' });
      }

      await checkPty(profile);
      console.log(
        `macOS smoke passed (${process.arch}, Electron ${process.versions.electron}): SQLite, Keychain round-trip, system tools, Bash PTY input/resize/exit.`,
      );
      exitCode = 0;
    } catch (error) {
      console.error(error);
    } finally {
      clearTimeout(timeout);
      rmSync(profile, { recursive: true, force: true });
      app.exit(exitCode);
    }
  });
}

function checkPty(cwd) {
  return new Promise((resolve, reject) => {
    const child = requireNative('node-pty').spawn(
      '/bin/bash',
      [
        '--noprofile',
        '--norc',
        '-c',
        'printf "DELA_READY\\n"; IFS= read -r input; printf "DELA_INPUT=%s\\n" "$input"; stty size',
      ],
      {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd,
        env: { HOME: cwd, PATH: '/usr/bin:/bin:/usr/sbin:/sbin' },
      },
    );
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('Bash PTY timed out'));
    }, 5000);
    let output = '';
    let sent = false;
    child.onData((data) => {
      output += data;
      if (!sent && output.includes('DELA_READY')) {
        sent = true;
        child.resize(100, 40);
        child.write('macOS-pty\r');
      }
    });
    child.onExit(({ exitCode }) => {
      clearTimeout(timeout);
      try {
        assert.equal(exitCode, 0);
        assert.match(output, /DELA_INPUT=macOS-pty/);
        assert.match(output, /40\s+100/);
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  });
}
