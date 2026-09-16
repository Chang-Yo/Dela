import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Dialog } from 'radix-ui';
import {
  FileText,
  FolderKanban,
  LoaderCircle,
  Mail,
  MessageSquare,
  Search,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { GlobalSearchResult } from '../../../shared/api';
import { cn } from '../../lib/utils';
import { Button } from '../../components/ui/button';

type SearchPhase = 'idle' | 'loading' | 'ready' | 'error';

const resultGroups: ReadonlyArray<{
  kind: GlobalSearchResult['kind'];
  label: string;
  icon: LucideIcon;
}> = [
  { kind: 'project', label: '本地项目', icon: FolderKanban },
  { kind: 'chat', label: '聊天对话', icon: MessageSquare },
  { kind: 'mail', label: '邮件', icon: Mail },
  { kind: 'course-file', label: '课程资料', icon: FileText },
];

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
        'flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 outline-none transition-colors',
        active ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/70',
      )}
      id={`global-search-result-${index}`}
      onClick={() => onActivate(result)}
      onMouseMove={() => onHover(index)}
      role="option"
    >
      <span
        aria-hidden="true"
        className="grid size-8 shrink-0 place-items-center rounded-md bg-muted"
      >
        <ResultIcon kind={result.kind} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{result.title}</span>
        {result.subtitle ? (
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
            {result.subtitle}
          </span>
        ) : null}
      </span>
    </div>
  );
}

function ResultIcon({ kind }: { kind: GlobalSearchResult['kind'] }) {
  const Icon = resultGroups.find((group) => group.kind === kind)?.icon ?? Search;
  return <Icon className="size-4 text-muted-foreground" strokeWidth={1.8} />;
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
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<readonly GlobalSearchResult[]>([]);
  const [phase, setPhase] = useState<SearchPhase>('idle');
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
    setResults([]);
    setSelectedIndex(-1);
    setError(null);
    setPhase('loading');
    const timer = window.setTimeout(() => {
      const search = window.dela?.search;
      if (!search) {
        if (requestId.current === id) {
          setPhase('error');
          setError('搜索功能暂不可用。');
        }
        return;
      }
      void search
        .query(query)
        .then((next) => {
          if (requestId.current !== id) return;
          setResults(next);
          setSelectedIndex(next.length ? 0 : -1);
          setPhase('ready');
        })
        .catch((reason: unknown) => {
          if (requestId.current !== id) return;
          setPhase('error');
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

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!results.length) return;
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      setSelectedIndex((current) => {
        const next = (current + delta + results.length) % results.length;
        window.requestAnimationFrame(() => {
          document
            .getElementById(`global-search-result-${next}`)
            ?.scrollIntoView({ block: 'nearest' });
        });
        return next;
      });
      return;
    }
    const selectedResult = results[selectedIndex];
    if (event.key === 'Enter' && !event.nativeEvent.isComposing && selectedResult) {
      event.preventDefault();
      selectResult(selectedResult);
    }
  };

  const groupedResults = resultGroups.map((group) => ({
    ...group,
    results: results.filter((result) => result.kind === group.kind),
  }));
  const isRecent = !query.trim();
  const resultListId = 'global-search-results';

  return (
    <Dialog.Root onOpenChange={onOpenChange} open={open}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/30 duration-200 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100dvh-var(--spacing)*8)] w-[calc(100%-var(--spacing)*8)] max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border bg-popover shadow-2xl outline-none duration-200 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            inputRef.current?.focus();
          }}
        >
          <div className="flex items-center gap-3 border-b px-4 py-3 sm:px-5">
            <Search
              aria-hidden="true"
              className="size-5 shrink-0 text-muted-foreground"
              strokeWidth={1.8}
            />
            <Dialog.Title className="sr-only">全局搜索</Dialog.Title>
            <Dialog.Description className="sr-only">
              搜索已同步到本机的项目、聊天、邮件和课程资料文件名。
            </Dialog.Description>
            <input
              aria-activedescendant={
                selectedIndex >= 0 ? `global-search-result-${selectedIndex}` : undefined
              }
              aria-autocomplete="list"
              aria-controls={resultListId}
              aria-expanded={phase === 'ready' && results.length > 0}
              aria-label="全局搜索"
              className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="搜索项目、聊天、邮件或课程资料…"
              ref={inputRef}
              role="combobox"
              maxLength={200}
              value={query}
            />
            <Dialog.Close asChild>
              <Button aria-label="关闭搜索" size="icon-sm" variant="ghost">
                <X />
              </Button>
            </Dialog.Close>
          </div>
          <div className="min-h-0 overflow-y-auto p-2 sm:p-3">
            {phase === 'loading' ? (
              <div
                className="flex items-center gap-2 px-3 py-5 text-sm text-muted-foreground"
                role="status"
              >
                <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                正在搜索本地已同步的数据…
              </div>
            ) : null}
            {phase === 'error' ? (
              <p className="px-3 py-5 text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}
            {phase === 'ready' && !results.length ? (
              <p className="px-3 py-5 text-sm text-muted-foreground">
                {isRecent ? '还没有可显示的最近记录。' : '没有找到匹配的本地数据。'}
              </p>
            ) : null}
            {phase === 'ready' && results.length ? (
              <div id={resultListId} role="listbox">
                <p className="px-3 pb-1 pt-2 text-xs font-medium text-muted-foreground">
                  {isRecent ? '本地记录' : '搜索结果'}
                </p>
                {groupedResults.map((group) => {
                  if (!group.results.length) return null;
                  const GroupIcon = group.icon;
                  return (
                    <section className="mt-2" key={group.kind}>
                      <h3 className="flex items-center gap-2 px-3 py-1 text-xs font-medium text-muted-foreground">
                        <GroupIcon aria-hidden="true" className="size-3.5" strokeWidth={1.8} />
                        {group.label}（最多 10 条）
                      </h3>
                      {group.results.map((result) => {
                        const index = results.indexOf(result);
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
              </div>
            ) : null}
          </div>
          <div className="flex items-center gap-3 border-t px-4 py-2 text-xs text-muted-foreground sm:px-5">
            <span>↑↓ 选择</span>
            <span>↵ 打开</span>
            <span className="ml-auto">Esc 关闭</span>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
