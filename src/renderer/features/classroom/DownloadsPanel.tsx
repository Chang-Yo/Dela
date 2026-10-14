// 侧栏下载任务面板：环形进度 + 名称与字节摘要；进行中可取消、完成可打开位置。
// 进度事件来自 main 推送（vsjtu:download-changed），触发钮对齐侧栏头的 icon-xs 规格。
import { useState } from 'react';
import { Popover } from 'radix-ui';
import { Check, Download, FolderOpen, X } from 'lucide-react';
import { ProgressRing } from '../../components/ui/beautifului/atoms/ProgressRing';
import { Button } from '../../components/ui/button';
import { menuPanel } from '../../components/ui/menu-styles';
import { cn } from '../../lib/utils';
import type { VideoDownload } from '../../../shared/vsjtu';
import { formatBytes } from './player-format';
import { useClassroom } from './store';

export function DownloadsPanel() {
  const downloads = useClassroom((state) => state.downloads);
  const cancelDownload = useClassroom((state) => state.cancelDownload);
  const revealDownload = useClassroom((state) => state.revealDownload);
  const [open, setOpen] = useState(false);
  const list = Object.values(downloads).reverse();
  const activeCount = list.filter((download) => download.state === 'progressing').length;

  return (
    <Popover.Root onOpenChange={setOpen} open={open}>
      <Popover.Trigger asChild>
        <span className="relative inline-flex">
          <Button
            aria-label={`下载任务，${activeCount} 个进行中`}
            className="hover:bg-hover-2"
            size="icon-xs"
            title="下载任务"
            variant="ghost"
          >
            <Download />
          </Button>
          {activeCount > 0 && (
            <span
              aria-hidden
              className="pointer-events-none absolute right-0.5 top-0.5 size-1.5 rounded-full bg-bui-accent"
            />
          )}
        </span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" className={cn(menuPanel, 'w-80')} sideOffset={6}>
          <p className="px-2 pb-1 pt-1.5 text-xs font-medium text-ink-3">
            下载任务{activeCount > 0 ? ` · ${activeCount} 个进行中` : ''}
          </p>
          {list.length === 0 ? (
            <div className="flex flex-col items-center gap-1.5 px-4 pb-4 pt-2 text-ink-3">
              <Download aria-hidden className="size-5 opacity-40" />
              <p className="text-xs">暂无下载任务</p>
              <p className="text-xs text-ink-3/80">在录像行或播放器里点下载</p>
            </div>
          ) : (
            <div className="flex flex-col">
              {list.map((download) => (
                <DownloadRow
                  download={download}
                  key={download.id}
                  onCancel={() => cancelDownload(download.id)}
                  onReveal={() => revealDownload(download.id)}
                />
              ))}
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function ringTone(state: VideoDownload['state']) {
  if (state === 'progressing') return { tone: 'accent', label: '下载中' } as const;
  if (state === 'completed') return { tone: 'green', label: '已完成' } as const;
  if (state === 'interrupted') return { tone: 'red', label: '已中断' } as const;
  return { tone: 'ink', label: '已取消' } as const;
}

function DownloadRow({
  download,
  onCancel,
  onReveal,
}: {
  download: VideoDownload;
  onCancel: () => void;
  onReveal: () => void;
}) {
  const { tone, label } = ringTone(download.state);
  const progress =
    download.total > 0
      ? Math.min(1, download.received / download.total)
      : download.state === 'completed'
        ? 1
        : 0;
  const percent = Math.floor(progress * 100);
  const size = formatBytes(download.total);
  const received = formatBytes(download.received);
  // 百分比在环内；文字行只留状态与字节摘要。
  const meta =
    download.state === 'progressing'
      ? [received, size && `/ ${size}`].filter(Boolean).join(' ')
      : download.state === 'completed'
        ? size
        : download.state === 'interrupted'
          ? received
          : null;

  return (
    <div className="flex items-center gap-2.5 rounded-chip px-2 py-2">
      <ProgressRing progress={progress} size={28} tone={tone}>
        {download.state === 'progressing' ? (
          <span className="text-9">{percent}%</span>
        ) : download.state === 'completed' ? (
          <Check aria-hidden className="size-3" />
        ) : null}
      </ProgressRing>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-13 text-ink">{download.name}</span>
        <span className="truncate text-xs tabular-nums text-ink-3">
          {meta ? `${label} · ${meta}` : label}
        </span>
      </div>
      {download.state === 'progressing' && (
        <Button
          aria-label="取消下载"
          className="hover:bg-hover-2"
          onClick={onCancel}
          size="icon-xs"
          title="取消"
          variant="ghost"
        >
          <X />
        </Button>
      )}
      {download.state === 'completed' && (
        <Button
          aria-label="打开所在位置"
          className="hover:bg-hover-2"
          onClick={onReveal}
          size="icon-xs"
          title="打开位置"
          variant="ghost"
        >
          <FolderOpen />
        </Button>
      )}
    </div>
  );
}
