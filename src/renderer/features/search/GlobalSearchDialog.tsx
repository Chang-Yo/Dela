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
import type { GlobalSearchResult } from '../../../shared/api';
import { cn } from '../../lib/utils';
import { GLOBAL_SEARCH_PER_KIND_LIMIT } from '../../../shared/search';
import { Button } from '../../components/ui/button';
import { settingsResultsFor } from '../settings/search-index';
import { dialogOverlay, dialogPanel } from '../../components/ui/motion';

const resultGroups: ReadonlyArray<{
  kind: GlobalSearchResult['kind'];
  label: string;
  icon: LucideIcon;
  /** 分组说明,标注主进程同步数据的条数上限。 */
  note?: string;
}> = [
  { kind: 'project', label: '本地项目', icon: FolderKanban, note: '最多 10 条' },
  { kind: 'chat', label: '聊天对话', icon: MessageSquare, note: '最多 10 条' },
  { kind: 'mail', label: '邮件', icon: Mail, note: '最多 10 条' },
  { kind: 'course-file', label: '课程资料', icon: FileText, note: '最多 10 条' },
  { kind: 'todo', label: 'TODO / 作业', icon: CircleCheckBig, note: '最多 10 条' },
  { kind: 'setting', label: '设置', icon: Settings },
];

/** 设置入口是渲染层静态数据（设置域 search-index 单一来源）,与主进程返回的同步数据在本地合并展示。 */

function ResultRow({
  active,
  index,
  onActivate,
  onHover,
  result,
}: {
  active: boolean;
  index: number;
  onActivate: (result: GlobalSearchResult) => void;
  onHover: (index: number) => void;
  result: GlobalSearchResult;
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
        <ResultIcon kind={result.kind} />
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

function ResultIcon({ kind }: { kind: GlobalSearchResult['kind'] }) {
  const Icon = resultGroups.find((group) => group.kind === kind)?.icon ?? Search;
  return <Icon className="size-4 text-ink-3" strokeWidth={1.8} />;
}

export function GlobalSearchDialog({
  onOpenChange,
  onSelect,
  open,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (result: GlobalSearchResult) => void;
}) {
  // results 跨打开/查询保留:新数据到达前继续展示旧结果,弹窗高度不会先塌陷再撑开。
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<readonly GlobalSearchResult[]>([]);
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
      const search = window.dela?.search;
      if (!search) {
        if (requestId.current === id) {
          setRefreshing(false);
          setError('搜索功能暂不可用。');
        }
        return;
      }
      void search
        .query(query)
        .then((next) => {
          if (requestId.current !== id) return;
          setResults(next);
          setSelectedIndex([...settingsResultsFor(query), ...next].length ? 0 : -1);
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

  const selectResult = (result: GlobalSearchResult) => {
    onSelect(result);
    onOpenChange(false);
  };

  const settingsMatches = settingsResultsFor(query);
  const allResults = [...settingsMatches, ...results];
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

  const groupedResults = resultGroups.map((group) => ({
    ...group,
    results: allResults.filter((result) => result.kind === group.kind),
  }));
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
                {groupedResults.map((group) => {
                  if (!group.results.length) return null;
                  const GroupIcon = group.icon;
                  return (
                    <section className="mt-1" key={group.kind}>
                      <h3 className="flex items-center gap-2 px-2.5 py-1 text-xs font-medium text-ink-3">
                        <GroupIcon aria-hidden="true" className="size-3.5" strokeWidth={1.8} />
                        {group.note && group.results.length >= GLOBAL_SEARCH_PER_KIND_LIMIT
                          ? `${group.label}（${group.note}）`
                          : group.label}
                      </h3>
                      {group.results.map((result) => {
                        const index = allResults.indexOf(result);
                        return (
                          <ResultRow
                            active={selectedIndex === index}
                            index={index}
                            key={`${result.kind}-${result.id}`}
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
