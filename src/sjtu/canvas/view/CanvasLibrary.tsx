import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Download, Ellipsis, Folder, GraduationCap, KeyRound, RefreshCw } from 'lucide-react';
import type { LibraryProps } from '../../../app/module';
import { errorMessage } from '../../../core/protocol/contract';
import { showToast } from '../../../ui/toast';
import { Button } from '../../../ui/button';
import { cn } from '../../../ui/lib/cn';
import { CollapseChevron } from '../../../ui/collapsible';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../../ui/dropdown-menu';
import { latestTermOf } from '../contract';
import { CanvasConnectDialog } from './CanvasConnectDialog';
import { CanvasExportDialog } from './CanvasExportDialog';
import { SourcesTree } from './SourcesTree';
import { canvasClient, stateKey, useCanvasState, useLibraryGrouping } from './use-canvas';

export function CanvasLibrary(props: LibraryProps) {
  const queryClient = useQueryClient();
  const canvas = useCanvasState();
  const { bySource, toggle } = useLibraryGrouping();
  const [open, setOpen] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [dialog, setDialog] = useState<'connect' | 'export' | null>(null);
  if (props.archived) return <SourcesTree {...props} />;

  const expanded = open || Boolean(props.query.trim());
  const refresh = async () => {
    if (syncing) return;
    setSyncing(true);
    const syncAll = async () => {
      // 先刷新课程列表，新学期的课程才拿得到；再逐门同步最新学期，顺序执行以免并发轰炸 Canvas。
      const state = await canvasClient.syncCourses();
      queryClient.setQueryData(stateKey, state);
      const latest = latestTermOf(state.courses);
      for (const course of state.courses)
        if (course.term === latest && !course.archived)
          queryClient.setQueryData(stateKey, await canvasClient.syncCourse(course.id));
    };
    try {
      await syncAll();
    } catch (cause) {
      showToast({ variant: 'error', title: '同步课程资料失败', description: errorMessage(cause) });
    }
    setSyncing(false);
  };

  return (
    <>
      <div className="flex h-8 items-center gap-1 px-3 text-xs font-medium text-ink-3">
        <button
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-1 text-left transition-colors duration-base hover:text-ink"
          onClick={() => setOpen((value) => !value)}
          type="button"
        >
          <CollapseChevron open={expanded} />
          <GraduationCap className="size-4" />
          课程资料
        </button>
        <Button
          aria-label="刷新课程资料"
          className="hover:bg-hover-strong"
          disabled={!canvas.connected}
          onClick={() => void refresh()}
          size="icon-xs"
          title="刷新课程资料"
          variant="ghost"
        >
          <RefreshCw className={cn(syncing && 'animate-spin')} />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              aria-label="Canvas 操作"
              className="hover:bg-hover-strong"
              size="icon-xs"
              title="Canvas 操作"
              variant="ghost"
            >
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onSelect={() => setDialog('connect')}>
              <KeyRound />
              {canvas.connected ? '更换 Canvas 令牌' : '连接 Canvas'}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                toggle();
                if (!bySource) props.onExpand('canvas', true);
              }}
            >
              <Folder />
              {bySource ? '按课程分组' : '按来源分组'}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!canvas.connected} onSelect={() => setDialog('export')}>
              <Download />
              批量导出课件
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {expanded &&
        (canvas.connected ? (
          <SourcesTree {...props} />
        ) : (
          <div className="px-4 py-3 text-xs text-ink-3">
            <p>连接 Canvas，查看课程资料。</p>
            <Button
              className="mt-3"
              onClick={() => setDialog('connect')}
              size="sm"
              variant="outline"
            >
              连接 Canvas
            </Button>
          </div>
        ))}
      {dialog === 'connect' && <CanvasConnectDialog onClose={() => setDialog(null)} />}
      {dialog === 'export' && <CanvasExportDialog onClose={() => setDialog(null)} />}
    </>
  );
}
