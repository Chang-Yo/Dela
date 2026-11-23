// magpie 应用默认不把命令放进 PATH（要在它的 设置 › 命令行 里打开），所以 PATH 找不到时改用应用自带的程序。
import { execFile } from 'node:child_process';

const windowsAppPath = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\magpie.exe';

/** Windows 上 magpie 每次启动都把自己的位置登记在 App Paths。 */
function registeredWindowsProgram(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('reg', ['query', windowsAppPath, '/ve'], { windowsHide: true }, (error, stdout) =>
      resolve(error ? null : (/REG_SZ\s+(.+)/.exec(stdout)?.[1]?.trim() ?? null)),
    );
  });
}

async function magpiePrograms(): Promise<string[]> {
  if (process.platform === 'darwin') {
    return ['magpie', '/Applications/magpie.app/Contents/MacOS/magpie'];
  }
  if (process.platform === 'win32') {
    const registered = await registeredWindowsProgram();
    return registered ? ['magpie', registered] : ['magpie'];
  }
  return ['magpie'];
}

/** 程序不存在时返回 false；安装失败时抛出 magpie 自己的输出。 */
function addPlugin(program: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    execFile(
      program,
      ['plugin', 'add', 'magpie-agent-dela'],
      { timeout: 180_000, windowsHide: true },
      (error, stdout, stderr) => {
        if (!error) resolve(true);
        else if (error.code === 'ENOENT') resolve(false);
        else reject(new Error(stderr.trim() || stdout.trim() || error.message));
      },
    );
  });
}

/** 返回 false 表示这台电脑上没有找到 magpie。 */
export async function installMagpiePlugin(): Promise<boolean> {
  for (const program of await magpiePrograms()) {
    if (await addPlugin(program)) return true;
  }
  return false;
}
