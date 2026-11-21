import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Windows 上不能取 PATH 里的 bash（可能是 WSL），要用 Git for Windows 的。 */
export function testBash(): string {
  if (process.platform !== 'win32') return 'bash';
  const gitBash = join(process.env.ProgramFiles ?? '', 'Git', 'bin', 'bash.exe');
  return existsSync(gitBash) ? gitBash : 'bash';
}
