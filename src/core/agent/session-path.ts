import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** 会话内文件操作：相对路径按会话 cwd 解析，目标必须是本机真实存在的路径。
 *  不做目录边界限制——Agent 本身已能用 bash 读写任意位置，UI 只负责打开它产出的文件。 */
export function resolveSessionFile(cwd: string, rawPath: string): string {
  const target = resolve(cwd, rawPath);
  if (!existsSync(target)) throw new Error('文件不存在，可能已被移动或删除');
  return target;
}
