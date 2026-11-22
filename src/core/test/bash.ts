import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Pi 要求 shell 是存在的绝对路径；Windows 不能取 PATH 里的 bash（可能是 WSL）。 */
export function testBash(): string {
  if (process.platform !== 'win32') return '/bin/bash';
  const gitBash = join(process.env.ProgramFiles ?? '', 'Git', 'bin', 'bash.exe');
  return existsSync(gitBash) ? gitBash : 'bash';
}
