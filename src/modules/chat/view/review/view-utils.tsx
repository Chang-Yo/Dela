// 审阅视图共用的展示件：状态文案、路径切片与居中占位。
// 路径切片只用于界面呈现，不保证与宿主 path 规则一致。
import type { ReactNode } from 'react';

export const STATUS_TEXT = { added: '新增', modified: '修改', deleted: '删除' } as const;

const lastSeparator = (path: string) => Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
export const basenameOf = (path: string) => path.slice(lastSeparator(path) + 1) || path;
export const dirnameOf = (path: string) => path.slice(0, Math.max(0, lastSeparator(path)));

export function Centered({ children, ...rest }: { children: ReactNode; role?: string }) {
  return (
    <div
      className="flex min-h-0 flex-1 items-center justify-center gap-1.5 p-6 text-center text-sm text-ink-3"
      {...rest}
    >
      {children}
    </div>
  );
}
