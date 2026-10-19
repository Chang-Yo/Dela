// 审阅视图共用的展示件：文件类型图标、状态文案、路径切片与居中占位。
// 路径切片只用于界面呈现，不保证与宿主 path 规则一致。
import { memo, type ReactNode } from 'react';
import { FileCode2, FileImage, FileText } from 'lucide-react';

const imageExtensions = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']);
const codeExtensions = new Set([
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'py',
  'ipynb',
  'c',
  'h',
  'cpp',
  'java',
  'cs',
  'go',
  'rs',
  'rb',
  'php',
  'swift',
  'kt',
  'sh',
  'bat',
  'ps1',
  'sql',
  'html',
  'css',
  'scss',
  'vue',
  'svelte',
  'json',
  'jsonc',
  'yml',
  'yaml',
  'toml',
  'xml',
]);

/** 文件类型图标：按扩展名分三档，颜色保持中性，形状足够区分。 */
export const FileIcon = memo(function FileIcon({ path }: { path: string }) {
  const base = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
  const dot = base.lastIndexOf('.');
  const extension = dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
  const Icon = imageExtensions.has(extension)
    ? FileImage
    : codeExtensions.has(extension)
      ? FileCode2
      : FileText;
  return <Icon aria-hidden className="size-3.5 shrink-0 text-ink-3" />;
});

export const STATUS_TEXT = { added: '新增', modified: '修改', deleted: '删除' } as const;

const lastSeparator = (path: string) => Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
export const basenameOf = (path: string) => path.slice(lastSeparator(path) + 1) || path;
export const dirnameOf = (path: string) => path.slice(0, Math.max(0, lastSeparator(path)));

export function Centered({ children, ...rest }: { children: ReactNode; role?: string }) {
  return (
    <div
      className="flex min-h-0 flex-1 items-center justify-center gap-1.5 p-6 text-center text-13 text-ink-3"
      {...rest}
    >
      {children}
    </div>
  );
}
