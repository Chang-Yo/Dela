import { isAbsolute, resolve } from 'node:path';
import { toolError, type ToolContext } from '../shared';

/** 相对路径按当前工作目录（默认项目目录）解析；绝对路径原样使用，无目录守卫。 */
export function resolveToolPath(path: string, context: ToolContext): string {
  if (!isAbsolute(path) && !context.cwd)
    throw toolError('INVALID_INPUT', '相对路径需要当前工作目录，请提供绝对路径');
  return resolve(context.cwd ?? '.', path);
}
