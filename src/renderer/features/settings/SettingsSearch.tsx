import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Search } from 'lucide-react';
import { cn } from '../../lib/utils';
import {
  filterSettingsItems,
  settingsSectionLabels,
  type SettingsSearchItem,
} from './search-index';

type SettingsSearchProps = {
  /** 选中结果：跳转对应分类并高亮目标项。 */
  onSelect: (item: SettingsSearchItem) => void;
};

/** 设置内搜索：按分类、选项标题与关键词过滤（关键词表见 search-index.ts）。 */
export function SettingsSearch({ onSelect }: SettingsSearchProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const matches = query.trim() ? filterSettingsItems(query) : [];
  const hasMatches = matches.length > 0;

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  const select = (item: SettingsSearchItem) => {
    onSelect(item);
    setQuery('');
    setOpen(false);
    inputRef.current?.blur();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      setQuery('');
      setOpen(false);
      return;
    }
    if (!hasMatches) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((current) => {
        const next =
          (current + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length;
        document
          .getElementById(`settings-search-result-${next}`)
          ?.scrollIntoView({ block: 'nearest' });
        return next;
      });
    } else if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      event.preventDefault();
      const item = matches[activeIndex];
      if (item) select(item);
    }
  };

  return (
    <div className="relative">
      <div className="flex h-9 items-center gap-2 rounded-lg border bg-background px-3">
        <Search
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground"
          strokeWidth={1.8}
        />
        <input
          aria-label="搜索设置"
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          maxLength={100}
          onBlur={() => setOpen(false)}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="搜索设置，如「主题」「API」「邮件」…"
          ref={inputRef}
          type="text"
          value={query}
        />
      </div>
      {open && query.trim() ? (
        hasMatches ? (
          <div
            className="absolute inset-x-0 top-11 z-20 grid max-h-72 overflow-y-auto rounded-lg border bg-popover p-1 shadow-lg"
            role="listbox"
          >
            {matches.map((item, index) => (
              <button
                aria-selected={index === activeIndex}
                className={cn(
                  'flex min-h-9 items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left outline-none transition-colors',
                  index === activeIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/70',
                )}
                id={`settings-search-result-${index}`}
                key={`${item.section}-${item.id}`}
                onClick={() => select(item)}
                onMouseDown={(event) => event.preventDefault()}
                role="option"
                type="button"
              >
                <span className="min-w-0 flex-1 truncate text-sm">{item.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {settingsSectionLabels[item.section]}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div
            className="absolute inset-x-0 top-11 z-20 rounded-lg border bg-popover p-3 text-sm text-muted-foreground shadow-lg"
            role="status"
          >
            没有匹配的设置项。
          </div>
        )
      ) : null}
    </div>
  );
}
