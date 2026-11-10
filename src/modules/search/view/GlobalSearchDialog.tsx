import { useState, type KeyboardEvent } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Dialog } from 'radix-ui';
import { useDebounce } from 'use-debounce';
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
import { createClient } from '../../../core/protocol/contract';
import { cn } from '../../../renderer/lib/utils';
import { Button } from '../../../renderer/components/ui/button';
import { dialogOverlay, dialogPanel } from '../../../renderer/components/ui/motion';
import { SEARCH_LIMIT, searchContract, type SearchHit, type SearchIcon } from '../contract';

const search = createClient(searchContract, window.dela?.bridge);

const groupIcons: Record<SearchIcon, LucideIcon> = {
  folder: FolderKanban,
  message: MessageSquare,
  mail: Mail,
  file: FileText,
  check: CircleCheckBig,
  settings: Settings,
};

const listId = 'global-search-results';
const optionId = (index: number) => `global-search-result-${index}`;

export function GlobalSearchDialog({
  onOpenChange,
  onSelect,
  open,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (hit: SearchHit) => void;
}) {
  const [query, setQuery] = useState('');
  // 拼音输入时每个字母都会触发 onChange，而主进程查询是同步的，防抖避免逐字查询。
  const [debouncedQuery] = useDebounce(query.trim(), 180);
  const results = useQuery({
    queryKey: ['search', debouncedQuery],
    queryFn: () => search.query(debouncedQuery),
    enabled: open,
    // 新结果到达前保留旧结果，弹窗高度不会先塌陷再撑开。
    placeholderData: keepPreviousData,
  });
  const groups = results.data ?? [];
  const hits = groups.flatMap((group) => group.hits);
  // 选中项只对产生它的那批结果有效；新结果到达后回到第一项。
  const [selection, setSelection] = useState({ batch: -1, index: -1 });
  const selectedIndex =
    selection.batch === results.dataUpdatedAt ? selection.index : hits.length ? 0 : -1;
  const select = (index: number) => setSelection({ batch: results.dataUpdatedAt, index });
  const hasContent = hits.length > 0;
  const isRecent = !query.trim();
  const busy = results.isFetching;
  const error = results.error?.message ?? null;

  const activate = (hit: SearchHit) => {
    onSelect(hit);
    onOpenChange(false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && hasContent) {
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      const next = (selectedIndex + delta + hits.length) % hits.length;
      select(next);
      document.getElementById(optionId(next))?.scrollIntoView({ block: 'nearest' });
      return;
    }
    const selected = hits[selectedIndex];
    if (event.key === 'Enter' && !event.nativeEvent.isComposing && selected) {
      event.preventDefault();
      activate(selected);
    }
  };

  return (
    <Dialog.Root onOpenChange={onOpenChange} open={open}>
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlay} />
        <Dialog.Content
          className={cn(
            dialogPanel,
            'flex max-h-[calc(100dvh-var(--spacing)*8)] w-[calc(100%-var(--spacing)*8)] max-w-xl flex-col overflow-hidden p-0',
          )}
        >
          <div className="flex items-center gap-2.5 border-b px-4 py-2.5">
            <Search aria-hidden="true" className="size-4 shrink-0 text-ink-3" strokeWidth={1.8} />
            <Dialog.Title className="sr-only">全局搜索</Dialog.Title>
            <Dialog.Description className="sr-only">
              搜索已同步到本机的项目、聊天、邮件、课程资料文件名和设置入口。
            </Dialog.Description>
            <input
              aria-activedescendant={selectedIndex >= 0 ? optionId(selectedIndex) : undefined}
              aria-autocomplete="list"
              aria-controls={listId}
              aria-expanded={hasContent}
              aria-label="全局搜索"
              className="min-w-0 flex-1 bg-transparent text-13 outline-none placeholder:text-ink-3"
              maxLength={200}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="搜索项目、聊天、邮件或课程资料…"
              role="combobox"
              value={query}
            />
            {busy ? (
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
            {!hasContent && busy ? (
              <div className="flex items-center gap-2 px-3 py-5 text-13 text-ink-3" role="status">
                <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                正在获取本地已同步的数据…
              </div>
            ) : null}
            {!hasContent && !busy && !error ? (
              <p className="px-3 py-5 text-13 text-ink-3">
                {isRecent ? '还没有可显示的最近记录。' : '没有找到匹配的本地数据。'}
              </p>
            ) : null}
            {hasContent ? (
              <div id={listId} role="listbox">
                <p className="px-2.5 pb-1 pt-1.5 text-xs font-medium text-ink-3">
                  {isRecent ? '本地记录' : '搜索结果'}
                </p>
                {groups.map((group) => {
                  const Icon = groupIcons[group.icon];
                  return (
                    <section className="mt-1" key={group.id}>
                      <h3 className="flex items-center gap-2 px-2.5 py-1 text-xs font-medium text-ink-3">
                        <Icon aria-hidden="true" className="size-3.5" strokeWidth={1.8} />
                        {group.truncated
                          ? `${group.label}（最多 ${SEARCH_LIMIT} 条）`
                          : group.label}
                      </h3>
                      {group.hits.map((hit) => {
                        const index = hits.indexOf(hit);
                        return (
                          <div
                            aria-selected={selectedIndex === index}
                            className={cn(
                              'flex cursor-pointer items-center gap-2.5 rounded-card px-2.5 py-2 outline-none transition-colors',
                              selectedIndex === index ? 'bg-hover-2 text-ink' : 'hover:bg-hover',
                            )}
                            id={optionId(index)}
                            key={`${group.id}-${hit.id}`}
                            onClick={() => activate(hit)}
                            onMouseMove={() => select(index)}
                            role="option"
                          >
                            <span
                              aria-hidden="true"
                              className="grid size-7 shrink-0 place-items-center rounded-control bg-inset"
                            >
                              <Icon className="size-4 text-ink-3" strokeWidth={1.8} />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-13 font-medium">
                                {hit.title}
                              </span>
                              {hit.subtitle ? (
                                <span className="mt-0.5 block truncate text-xs text-ink-3">
                                  {hit.subtitle}
                                </span>
                              ) : null}
                            </span>
                          </div>
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
