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

export function FileIcon({ path }: { path: string }) {
  const base = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
  const dot = base.lastIndexOf('.');
  const extension = dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
  const Icon = imageExtensions.has(extension)
    ? FileImage
    : codeExtensions.has(extension)
      ? FileCode2
      : FileText;
  return <Icon aria-hidden className="size-3.5 shrink-0 text-ink-3" />;
}
