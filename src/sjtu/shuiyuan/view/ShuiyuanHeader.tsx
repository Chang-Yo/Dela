import { useRef, useState } from 'react';
import { useIsFetching, useQueryClient } from '@tanstack/react-query';
import { Bell, Bookmark, Mail, RefreshCw } from 'lucide-react';
import { CountBadge } from '../../../ui/count-badge';
import { SearchInput } from '../../../ui/search-input';
import { SegmentedControl } from '../../../ui/segmented-control';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../ui/select';
import { cn } from '../../../ui/lib/cn';
import { useShuiyuan, type ListSelection } from './store';
import { IconButton } from '../../../ui/icon-button';
import { listKey, useCounts, useSelectList, useSiteStructure } from './use-shuiyuan';

const SEARCH_DEBOUNCE_MS = 400;
const feedKinds = ['latest', 'featured'] as const;
const feedLabels = { latest: '最新', featured: '精品' };

function PersonalButton({
  active,
  label,
  count,
  icon: Icon,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number | null;
  icon: typeof Bookmark;
  onClick: () => void;
}) {
  return (
    <IconButton
      aria-current={active ? 'page' : undefined}
      className="relative"
      onClick={onClick}
      size="lg"
      title={label}
    >
      <Icon strokeWidth={1.8} />
      {count && count > 0 ? (
        <CountBadge className="absolute -right-1.5 -top-1" count={count} />
      ) : null}
    </IconButton>
  );
}

export function ShuiyuanHeader() {
  const queryClient = useQueryClient();
  const list = useShuiyuan((state) => state.list);
  const structure = useSiteStructure();
  const counts = useCounts();
  const listLoading = useIsFetching({ queryKey: listKey(list), exact: true }) > 0;
  const choose = useSelectList();
  const [search, setSearch] = useState('');
  // 搜索前的上一个来源：清空搜索时还原。
  const [beforeSearch, setBeforeSearch] = useState<ListSelection | null>(null);
  const searchTimer = useRef<number | undefined>(undefined);

  // 显式切换取消待发的搜索，到点不再抢回列表。
  const selectList = (next: ListSelection) => {
    window.clearTimeout(searchTimer.current);
    choose(next);
  };

  const changeSearch = (value: string) => {
    setSearch(value);
    window.clearTimeout(searchTimer.current);
    const query = value.trim();
    if (!query) {
      if (list.kind === 'search' && beforeSearch) {
        setBeforeSearch(null);
        choose(beforeSearch);
      }
      return;
    }
    if (list.kind !== 'search') setBeforeSearch(list);
    searchTimer.current = window.setTimeout(
      () => choose({ kind: 'search', query }),
      SEARCH_DEBOUNCE_MS,
    );
  };

  const feedKind =
    list.kind === 'bookmarks' || list.kind === 'messages' || list.kind === 'notifications'
      ? 'latest'
      : list.kind;
  const categoryValue = list.kind === 'category' ? String(list.categoryId) : 'all';
  const tagValue = list.kind === 'tag' ? list.tag : 'all';
  const roots = (structure?.categories ?? []).filter((category) => category.parentId === null);
  const childrenOf = (parentId: number) =>
    (structure?.categories ?? []).filter((category) => category.parentId === parentId);

  return (
    <header className="border-b border-line bg-surface/95 px-4 py-2 backdrop-blur max-md:px-3">
      <div className="flex flex-col gap-2 lg:grid lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:items-center">
        <div className="flex items-center gap-2.5 lg:contents">
          <div className="flex flex-wrap items-center gap-0.5 lg:col-start-1 lg:row-start-1 lg:justify-self-start">
            <PersonalButton
              active={list.kind === 'bookmarks'}
              count={null}
              icon={Bookmark}
              label="收藏"
              onClick={() => selectList({ kind: 'bookmarks' })}
            />
            <PersonalButton
              active={list.kind === 'notifications'}
              count={counts?.notifications ?? null}
              icon={Bell}
              label="通知"
              onClick={() => selectList({ kind: 'notifications' })}
            />
            <PersonalButton
              active={list.kind === 'messages'}
              count={counts?.messages ?? null}
              icon={Mail}
              label="私信"
              onClick={() => selectList({ kind: 'messages' })}
            />
          </div>
          <div className="ml-auto flex flex-1 flex-wrap items-center justify-end gap-2.5 lg:col-start-3 lg:row-start-1 lg:ml-0 lg:justify-self-end">
            <SearchInput
              aria-label="搜索水源"
              className="min-w-32 max-w-56 flex-1"
              onChange={(event) => changeSearch(event.target.value)}
              placeholder="搜索帖子"
              type="search"
              value={search}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2.5 lg:col-start-2 lg:row-start-1 lg:justify-self-center">
          <SegmentedControl
            aria-label="信息流类型"
            labels={feedLabels}
            onChange={(kind) => selectList({ kind })}
            options={feedKinds}
            value={feedKind === 'latest' || feedKind === 'featured' ? feedKind : null}
          />
          <span aria-hidden="true" className="h-4 w-px shrink-0 bg-line" />
          <Select
            onValueChange={(value) => {
              selectList(
                value === 'all'
                  ? { kind: 'latest' }
                  : { kind: 'category', categoryId: Number(value) },
              );
            }}
            value={categoryValue}
          >
            <SelectTrigger aria-label="类别" className="h-8 w-28 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部类别</SelectItem>
              {roots.flatMap((category) => [
                <SelectItem key={category.id} value={String(category.id)}>
                  {category.name}
                </SelectItem>,
                ...childrenOf(category.id).map((child) => (
                  <SelectItem key={child.id} value={String(child.id)}>
                    └ {child.name}
                  </SelectItem>
                )),
              ])}
            </SelectContent>
          </Select>
          <Select
            onValueChange={(value) => {
              selectList(value === 'all' ? { kind: 'latest' } : { kind: 'tag', tag: value });
            }}
            value={tagValue}
          >
            <SelectTrigger aria-label="标签" className="h-8 w-28 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部标签</SelectItem>
              {(structure?.tags ?? []).slice(0, 60).map((tag) => (
                <SelectItem key={tag.name} value={tag.name}>
                  {tag.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <IconButton
            size="lg"
            aria-label="刷新"
            onClick={() => {
              selectList(list);
              void queryClient.invalidateQueries({ queryKey: ['shuiyuan', 'counts'] });
            }}
            title="刷新"
          >
            <RefreshCw className={cn(listLoading && 'animate-spin')} strokeWidth={1.8} />
          </IconButton>
        </div>
      </div>
    </header>
  );
}
