import { useEffect, useState, type CSSProperties } from 'react';
import { Resizer } from '../../components/ui/resizer';
import { cn } from '../../lib/utils';
import { SourceDetail } from './SourceDetail';
import { SourceList } from './SourceList';

const LIST_MIN = 240;
const LIST_MAX = 420;

export function SourcesView() {
  const [listWidth, setListWidth] = useState(300);
  const [listCollapsed, setListCollapsed] = useState(() => {
    try {
      return localStorage.getItem('dela.sources.list-collapsed') === 'true';
    } catch {
      return false;
    }
  });
  const [listResizing, setListResizing] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem('dela.sources.list-collapsed', String(listCollapsed));
    } catch {
      /* Storage may be unavailable. */
    }
  }, [listCollapsed]);

  return (
    <div
      className={cn(
        'grid min-h-0 flex-1 grid-cols-[var(--list-width)_var(--detail-area)] overflow-hidden bg-card transition-[grid-template-columns] duration-150 ease-out max-md:block max-md:overflow-auto',
        listResizing && 'transition-none',
      )}
      style={
        {
          '--list-width': listCollapsed ? '48px' : `${listWidth}px`,
          '--detail-area': listCollapsed ? '0px' : '1px minmax(0,1fr)',
        } as CSSProperties
      }
    >
      <SourceList
        collapsed={listCollapsed}
        onToggleCollapsed={() => setListCollapsed((value) => !value)}
      />
      {!listCollapsed && (
        <Resizer
          className="max-md:hidden"
          label="调整资料列表宽度"
          max={LIST_MAX}
          min={LIST_MIN}
          onChange={setListWidth}
          onResizingChange={setListResizing}
          value={listWidth}
        />
      )}
      {!listCollapsed && <SourceDetail />}
    </div>
  );
}
