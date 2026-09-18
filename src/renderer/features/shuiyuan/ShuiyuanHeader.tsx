import { useEffect, useRef, useState } from 'react';
import { Bell, Bookmark, Mail, RefreshCw, Search } from 'lucide-react';
import { Input } from '../../components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { cn } from '../../lib/utils';
import { useShuiyuan, type ListSelection } from './store';

/** 顶栏：feed 切换（最新/精品）、类别/标签筛选、搜索与三个个人入口。 */
export function ShuiyuanHeader() {
  const list = useShuiyuan((state) => state.list);
  const structure = useShuiyuan((state) => state.structure);
  const counts = useShuiyuan((state) => state.counts);
  const listLoading = useShuiyuan((state) => state.listLoading);
  const selectList = useShuiyuan((state) => state.selectList);
  const refreshList = useShuiyuan((state) => state.refreshList);
  const refreshCounts = useShuiyuan((state) => state.refreshCounts);
  const [search, setSearch] = useState('');
  // 搜索前的上一个来源：清空搜索时还原。
  const beforeSearch = useRef<ListSelection | null>(null);

  useEffect(() => {
    const query = search.trim();
    if (!query) {
      if (list.kind === 'search' && beforeSearch.current) {
        const restore = beforeSearch.current;
        beforeSearch.current = null;
        void selectList(restore);
      }
      return;
    }
    if (list.kind !== 'search') beforeSearch.current = list;
    const timer = setTimeout(() => {
      void selectList({ kind: 'search', query });
    }, 400);
    return () => clearTimeout(timer);
    // search/list 手动依赖：仅在输入变化时重设防抖。
  }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  const feedKind =
    list.kind === 'bookmarks' || list.kind === 'messages' || list.kind === 'notifications'
      ? 'latest'
      : list.kind;
  const categoryValue = list.kind === 'category' ? String(list.categoryId) : 'all';
  const tagValue = list.kind === 'tag' ? list.tag : 'all';
  const roots = (structure?.categories ?? []).filter((category) => category.parentId === null);
  const childrenOf = (parentId: number) =>
    (structure?.categories ?? []).filter((category) => category.parentId === parentId);

  const personalButton = (
    active: boolean,
    label: string,
    count: number | null,
    Icon: typeof Bookmark,
    onClick: () => void,
  ) => (
    <button
      aria-current={active ? 'true' : undefined}
      className={cn(
        'relative grid size-8 place-items-center rounded-md transition-colors',
        active
          ? 'bg-sidebar-accent text-foreground'
          : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground',
      )}
      onClick={onClick}
      title={label}
      type="button"
    >
      <Icon className="size-4" strokeWidth={1.8} />
      {count && count > 0 ? (
        <span className="absolute -right-1.5 -top-1 rounded-full bg-primary px-1 text-[9px] font-medium leading-[14px] tabular-nums text-primary-foreground">
          {count > 99 ? '99+' : count}
        </span>
      ) : null}
    </button>
  );

  return (
    <header className="border-b bg-background/95 px-4 py-2 backdrop-blur max-md:px-3">
      {/* 宽屏三区网格（左入口 / 中筛选 / 右搜索），窄屏退化为纵向三行。 */}
      <div className="flex flex-col gap-2 lg:grid lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:items-center">
        <div className="flex flex-wrap items-center gap-0.5 justify-self-start">
          {personalButton(
            list.kind === 'bookmarks',
            '收藏',
            null,
            Bookmark,
            () => void selectList({ kind: 'bookmarks' }),
          )}
          {personalButton(
            list.kind === 'notifications',
            '通知',
            counts?.notifications ?? null,
            Bell,
            () => void selectList({ kind: 'notifications' }),
          )}
          {personalButton(
            list.kind === 'messages',
            '私信',
            counts?.messages ?? null,
            Mail,
            () => void selectList({ kind: 'messages' }),
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2.5 justify-self-center">
          {/* 分段控件：底槽 + 浮起的活动段，替代描边按钮组。 */}
          <div
            aria-label="信息流类型"
            className="flex items-center gap-0.5 rounded-lg bg-muted p-0.5"
            role="group"
          >
            <button
              aria-pressed={feedKind === 'latest'}
              className={cn(
                'h-7 rounded-md px-3 text-[13px] font-medium transition-all',
                feedKind === 'latest'
                  ? 'bg-background text-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground',
              )}
              onClick={() => void selectList({ kind: 'latest' })}
              type="button"
            >
              最新
            </button>
            <button
              aria-pressed={feedKind === 'featured'}
              className={cn(
                'h-7 rounded-md px-3 text-[13px] font-medium transition-all',
                feedKind === 'featured'
                  ? 'bg-background text-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground',
              )}
              onClick={() => void selectList({ kind: 'featured' })}
              type="button"
            >
              精品
            </button>
          </div>
          <Select
            onValueChange={(value) => {
              void selectList(
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
              void selectList(value === 'all' ? { kind: 'latest' } : { kind: 'tag', tag: value });
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
        </div>
        <div className="flex flex-wrap items-center gap-2.5 justify-self-end">
          <button
            aria-label="刷新"
            className="grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-foreground"
            onClick={() => {
              void refreshList();
              void refreshCounts();
            }}
            title="刷新"
            type="button"
          >
            <RefreshCw className={cn('size-4', listLoading && 'animate-spin')} strokeWidth={1.8} />
          </button>
          <div className="relative min-w-32 max-w-56 flex-1">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              aria-label="搜索水源"
              className="h-8 pl-8 text-xs"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索帖子"
              type="search"
              value={search}
            />
          </div>
        </div>
      </div>
    </header>
  );
}
