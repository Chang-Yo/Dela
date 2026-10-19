// unified patch 的只读呈现：双侧行号 + 增删着色。行级数据来自 shared/diff 的解析，
// 长 diff 分页，避免小体积、多行文件一次创建大量 DOM；长行横向滚动。
import { memo, useMemo, useState } from 'react';
import { parseUnifiedPatch } from '../../../shared/diff';
import { Button } from '@/components/ui/button';

// 每页约 2,500 个元素，限制渲染量且保留足够的上下文。
const PAGE_ROWS = 500;

const rowBackground: Record<string, string> = {
  hunk: 'bg-field text-ink-3',
  add: 'bg-green-tint',
  del: 'bg-red-tint',
  context: '',
};

const rowText: Record<string, string> = {
  hunk: 'text-ink-3',
  add: 'text-green',
  del: 'text-red',
  context: '',
};

export const DiffView = memo(function DiffView({ patch }: { patch: string }) {
  return <PagedDiff key={patch} patch={patch} />;
});

function PagedDiff({ patch }: { patch: string }) {
  const rows = useMemo(() => parseUnifiedPatch(patch), [patch]);
  const [page, setPage] = useState(0);
  const pages = Math.ceil(rows.length / PAGE_ROWS);
  const start = page * PAGE_ROWS;
  return (
    <>
      {pages > 1 && (
        <div className="flex items-center gap-2 px-3 pb-2 text-xs text-ink-3">
          <Button
            size="sm"
            variant="outline"
            disabled={page === 0}
            onClick={() => setPage(page - 1)}
          >
            上一页
          </Button>
          <span role="status">
            第 {page + 1} / {pages} 页 · 共 {rows.length} 行
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={page + 1 === pages}
            onClick={() => setPage(page + 1)}
          >
            下一页
          </Button>
        </div>
      )}
      <div
        aria-label="文件差异"
        className="min-w-0 overflow-x-auto font-mono text-2xs leading-5"
        role="table"
      >
        {rows.slice(start, start + PAGE_ROWS).map((row, index) => (
          <div
            className={`flex min-w-max ${rowBackground[row.kind]}`}
            key={start + index}
            role="row"
          >
            <span
              className="w-10 shrink-0 select-none pr-1.5 text-right text-ink-3"
              role="rowheader"
            >
              {row.oldLine ?? ''}
            </span>
            <span
              className="w-10 shrink-0 select-none pr-1.5 text-right text-ink-3"
              role="rowheader"
            >
              {row.newLine ?? ''}
            </span>
            <span aria-hidden className="w-4 shrink-0 select-none text-center text-ink-3">
              {row.kind === 'add' ? '+' : row.kind === 'del' ? '-' : ''}
            </span>
            <span className={`whitespace-pre pr-4 ${rowText[row.kind]}`} role="cell">
              {row.text || ' '}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
