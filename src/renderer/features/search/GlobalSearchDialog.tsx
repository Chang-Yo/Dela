import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Dialog } from 'radix-ui';
import {
  CircleCheckBig,
  FileText,
  FolderKanban,
  LoaderCircle,
  Mail,
  MessageSquare,
  Search,
  Settings,
  X,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import { dialogOverlay, dialogPanel } from '../../components/ui/motion';
import { createClient } from '../../../core/protocol/contract';
import {
  SEARCH_LIMIT,
  searchContract,
  type SearchGroup,
  type SearchHit,
  type SearchIcon,
} from '../../../modules/search/contract';

const searchClient = createClient(searchContract, window.dela?.bridge);

const groupIcons: Record<SearchIcon, LucideIcon> = {
  folder: FolderKanban,
  message: MessageSquare,
  mail: Mail,
  file: FileText,
  check: CircleCheckBig,
  settings: Settings,
};

function ResultRow({
  active,
  icon: Icon,
  index,
  onActivate,
  onHover,
  result,
}: {
  active: boolean;
  icon: LucideIcon;
  index: number;
  onActivate: (result: SearchHit) => void;
  onHover: (index: number) => void;
  result: SearchHit;
}) {
  return (
    <div
      aria-selected={active}
      className={cn(
        'flex cursor-pointer items-center gap-2.5 rounded-card px-2.5 py-2 outline-none transition-colors',
        active ? 'bg-hover-2 text-ink' : 'hover:bg-hover',
      )}
      id={`global-search-result-${index}`}
      onClick={() => onActivate(result)}
      onMouseMove={() => onHover(index)}
      role="option"
    >
      <span
        aria-hidden="true"
        className="grid size-7 shrink-0 place-items-center rounded-control bg-inset"
      >
        <Icon className="size-4 text-ink-3" strokeWidth={1.8} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-13 font-medium">{result.title}</span>
        {result.subtitle ? (
          <span className="mt-0.5 block truncate text-xs text-ink-3">{result.subtitle}</span>
        ) : null}
      </span>
    </div>
  );
}

export function GlobalSearchDialog({
  onOpenChange,
  onSelect,
  open,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (result: SearchHit) => void;
}) {
  // groups 跨打开/查询保留:新数据到达前继续展示旧结果,弹窗高度不会先塌陷再撑开。
  const [query, setQuery] = useState('');
  const [groups, setGroups] = useState<readonly SearchGroup[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestId = useRef(0);

  useEffect(() => {
    if (!open) {
      requestId.current += 1;
      return;
    }

    const id = ++requestId.current;
    setError(null);
    setRefreshing(true);
    const timer = window.setTimeout(() => {
      void searchClient
        .query(query)
        .then((next) => {
          if (requestId.current !== id) return;
          setGroups(next);
          setSelectedIndex(next.length ? 0 : -1);
          setRefreshing(false);
        })
        .catch((reason: unknown) => {
          if (requestId.current !== id) return;
          setRefreshing(false);
          setError(reason instanceof Error ? reason.message : '搜索失败，请重试。');
        });
    }, 180);

    return () => {
      window.clearTimeout(timer);
      requestId.current += 1;
    };
  }, [open, query]);

  const selectResult = (result: SearchHit) => {
    onSelect(result);
    onOpenChange(false);
  };

  const allResults = groups.flatMap((group) => group.hits);
  const hasContent = allResults.length > 0;

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!allResults.length) return;
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      setSelectedIndex((current) => {
        const next = (current + delta + allResults.length) % allResults.length;
        window.requestAnimationFrame(() => {
          document
            .getElementById(`global-search-result-${next}`)
            ?.scrollIntoView({ block: 'nearest' });
        });
        return next;
      });
      return;
    }
    const selectedResult = allResults[selectedIndex];
    if (event.key === 'Enter' && !event.nativeEvent.isComposing && selectedResult) {
      event.preventDefault();
      selectResult(selectedResult);
    }
  };

  const isRecent = !query.trim();
  const resultListId = 'global-search-results';

  return (
    <Dialog.Root onOpenChange={onOpenChange} open={open}>
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlay} />
        <Dialog.Content
          className={cn(
            dialogPanel,
            'flex max-h-[calc(100dvh-var(--spacing)*8)] w-[calc(100%-var(--spacing)*8)] max-w-xl flex-col overflow-hidden p-0',
          )}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            inputRef.current?.focus();
          }}
        >
          <div className="flex items-center gap-2.5 border-b px-4 py-2.5">
            <Search aria-hidden="true" className="size-4 shrink-0 text-ink-3" strokeWidth={1.8} />
            <Dialog.Title className="sr-only">全局搜索</Dialog.Title>
            <Dialog.Description className="sr-only">
              搜索已同步到本机的项目、聊天、邮件、课程资料文件名和设置入口。
            </Dialog.Description>
            <input
              aria-activedescendant={
                selectedIndex >= 0 ? `global-search-result-${selectedIndex}` : undefined
              }
              aria-autocomplete="list"
              aria-controls={resultListId}
              aria-expanded={hasContent}
              aria-label="全局搜索"
              className="min-w-0 flex-1 bg-transparent text-13 outline-none placeholder:text-ink-3"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="搜索项目、聊天、邮件或课程资料…"
              ref={inputRef}
              role="combobox"
              maxLength={200}
              value={query}
            />
            {refreshing ? (
              <LoaderCircle
                aria-hidden="true"
                className="size-4 shrink-0 animate-spin text-ink-3"
              />
            ) : null}
            <Dialog.Close asChild>
              <Button aria-label="关闭搜索" size="icon-sm" variant="ghost">
                <X />
              </Button>
            </Dialog.Close>
          </div>
          <div className="max-h-80 min-h-0 overflow-y-auto p-2">
            {error && !hasContent ? (
              <p className="px-3 py-5 text-13 text-red" role="alert">
                {error}
              </p>
            ) : null}
            {!hasContent && refreshing ? (
              <div className="flex items-center gap-2 px-3 py-5 text-13 text-ink-3" role="status">
                <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                正在获取本地已同步的数据…
              </div>
            ) : null}
            {!hasContent && !refreshing && !error ? (
              <p className="px-3 py-5 text-13 text-ink-3">
                {isRecent ? '还没有可显示的最近记录。' : '没有找到匹配的本地数据。'}
              </p>
            ) : null}
            {hasContent ? (
              <div id={resultListId} role="listbox">
                <p className="px-2.5 pb-1 pt-1.5 text-xs font-medium text-ink-3">
                  {isRecent ? '本地记录' : '搜索结果'}
                </p>
                {groups.map((group) => {
                  const GroupIcon = groupIcons[group.icon];
                  return (
                    <section className="mt-1" key={group.id}>
                      <h3 className="flex items-center gap-2 px-2.5 py-1 text-xs font-medium text-ink-3">
                        <GroupIcon aria-hidden="true" className="size-3.5" strokeWidth={1.8} />
                        {group.truncated
                          ? `${group.label}（最多 ${SEARCH_LIMIT} 条）`
                          : group.label}
                      </h3>
                      {group.hits.map((result) => {
                        const index = allResults.indexOf(result);
                        return (
                          <ResultRow
                            active={selectedIndex === index}
                            icon={GroupIcon}
                            index={index}
                            key={`${group.id}-${result.id}`}
                            onActivate={selectResult}
                            onHover={setSelectedIndex}
                            result={result}
                          />
                        );
                      })}
                    </section>
                  );
                })}
                {error ? (
                  <p className="px-3 py-2 text-xs text-red" role="status">
                    {error}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
          <div className="flex items-center gap-3 border-t px-4 py-1.5 text-xs text-ink-3">
            <span>↑↓ 选择</span>
            <span>↵ 打开</span>
            <span className="ml-auto">Esc 关闭</span>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
