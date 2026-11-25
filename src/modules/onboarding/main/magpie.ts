// magpie 应用默认不把命令放进 PATH（要在它的 设置 › 命令行 里打开），所以 PATH 找不到时改用应用自带的程序。
import { execFile } from 'node:child_process';
import { z } from 'zod';

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

async function runMagpie(args: string[], timeout: number): Promise<string | null> {
  for (const program of await magpiePrograms()) {
    const output = await new Promise<string | null>((resolve, reject) => {
      execFile(
        program,
        args,
        { timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
        (error, stdout, stderr) => {
          if (!error) resolve(stdout);
          else if (error.code === 'ENOENT') resolve(null);
          else reject(new Error(stderr.trim() || stdout.trim() || error.message));
        },
      );
    });
    if (output !== null) return output;
  }
  return null;
}

/** 返回 false 表示这台电脑上没有找到 magpie。 */
export async function installMagpiePlugin(): Promise<boolean> {
  return (await runMagpie(['plugin', 'add', 'magpie-agent-dela'], 180_000)) !== null;
}

export async function magpiePluginStatus(): Promise<'installed' | 'not-installed' | 'unavailable'> {
  const output = await runMagpie(['plugin', 'list', '--json'], 30_000);
  if (output === null) return 'unavailable';
  const { plugins } = z
    .object({ plugins: z.array(z.object({ spec: z.string() })) })
    .parse(JSON.parse(output));
  return plugins.some(({ spec }) => /^magpie-agent-dela(?:@[^\s]+)?$/.test(spec))
    ? 'installed'
    : 'not-installed';
}
