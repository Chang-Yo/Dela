import { useEffect, useState } from 'react';
import { Popover } from 'radix-ui';
import { Check, Download, FolderOpen, RotateCcw, X } from 'lucide-react';
import type { CanvasDownload } from '../../shared/canvas';
import { Button } from '../components/ui/button';
import { ProgressRing } from '../components/ui/beautifului/atoms/ProgressRing';
import { menuPanel } from '../components/ui/menu-styles';
import { showToast } from '../app/toasts';
import { errorText } from '../workspace/store';
import { cn } from '../lib/utils';

const active = (task: CanvasDownload) =>
  ['queued', 'preparing', 'downloading', 'stopping'].includes(task.state);
const labels = {
  queued: '等待中',
  preparing: '正在读取目录',
  downloading: '下载中',
  stopping: '当前文件完成后停止',
  completed: '已结束',
  cancelled: '已停止',
  failed: '任务失败',
};
const fileLabels = {
  queued: '等待中',
  downloading: '下载中',
  completed: '成功',
  cancelled: '未下载',
  failed: '失败',
};

export function CanvasDownloadsPanel({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [downloads, setDownloads] = useState<CanvasDownload[]>([]);
  useEffect(() => {
    const api = window.dela?.canvas;
    if (!api) return;
    let disposed = false;
    let received = false;
    const unsubscribe = api.onDownloadsChanged((tasks) => {
      received = true;
      setDownloads(tasks);
    });
    void api
      .downloads()
      .then((tasks) => {
        if (!disposed && !received) setDownloads(tasks);
      })
      .catch((cause) => {
        if (!disposed)
          showToast({ variant: 'error', title: '读取下载任务失败', description: errorText(cause) });
      });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);
  const count = downloads.filter(active).length;
  const perform = async (operation: () => Promise<unknown>) => {
    try {
      await operation();
    } catch (cause) {
      showToast({ variant: 'error', title: '下载操作失败', description: errorText(cause) });
    }
  };
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>
        <Button
          aria-label={`课程下载任务，${count} 个进行中`}
          title="课程下载任务"
          variant="ghost"
          size="icon-xs"
          className="relative hover:bg-hover-2"
        >
          <Download />
          {count > 0 && (
            <span
              aria-hidden
              className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-bui-accent"
            />
          )}
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" className={cn(menuPanel, 'w-80 max-h-96')} sideOffset={6}>
          <p className="px-2 py-1.5 text-xs font-medium text-ink-3">课程下载任务</p>
          {downloads.length === 0 ? (
            <p className="px-2 py-3 text-xs text-ink-3">在课程或文件夹的操作菜单中选择下载。</p>
          ) : (
            <div className="space-y-2 px-1 pb-1">
              {[...downloads].reverse().map((task) => {
                const succeeded = task.files.filter((file) => file.state === 'completed').length;
                const failed = task.files.filter((file) => file.state === 'failed').length;
                const processed = succeeded + failed;
                const busy = active(task);
                return (
                  <div key={task.id} className="rounded-chip p-2">
                    <div className="flex items-center gap-2.5">
                      <ProgressRing
                        progress={task.files.length ? processed / task.files.length : 0}
                        tone={failed || task.error ? 'red' : busy ? 'accent' : 'ink'}
                      >
                        {!busy && succeeded > 0 && failed === 0 && !task.error ? (
                          <Check className="size-3" />
                        ) : null}
                      </ProgressRing>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-13" title={task.title}>
                          {task.title}
                        </p>
                        <p role="status" className="text-xs text-ink-3">
                          {task.state === 'completed' && task.files.length === 0
                            ? '没有可下载的文件'
                            : `${labels[task.state]} · ${processed}/${task.files.length}`}
                        </p>
                      </div>
                      {busy && task.state !== 'stopping' && (
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          title="停止剩余下载，当前文件完成后停止"
                          aria-label={`停止下载 ${task.title}`}
                          onClick={() =>
                            void perform(() => window.dela!.canvas.stopDownload(task.id))
                          }
                        >
                          <X />
                        </Button>
                      )}
                      {!busy && (
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          title="打开保存目录"
                          aria-label={`打开保存目录 ${task.title}`}
                          onClick={() =>
                            void perform(() => window.dela!.canvas.revealDownload(task.id))
                          }
                        >
                          <FolderOpen />
                        </Button>
                      )}
                    </div>
                    <p className="mt-1 break-all text-xs text-ink-3" title={task.directory}>
                      {task.directory}
                    </p>
                    <p className="mt-1 text-xs text-ink-3">
                      成功 {succeeded} · 失败 {failed} · 未完成 {task.files.length - processed}
                    </p>
                    {task.warning && (
                      <p className="mt-1 whitespace-pre-line break-words text-xs text-orange">
                        {task.warning}
                      </p>
                    )}
                    {task.error && (
                      <p role="alert" className="mt-1 break-words text-xs text-red">
                        {task.error}
                      </p>
                    )}
                    {!busy && (failed > 0 || task.error) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="mt-1"
                        onClick={() =>
                          void perform(() => window.dela!.canvas.retryDownload(task.id))
                        }
                      >
                        <RotateCcw />
                        重试失败项
                      </Button>
                    )}
                    {task.files.length > 0 && (
                      <details className="mt-1 text-xs">
                        <summary className="cursor-pointer text-ink-3">文件明细</summary>
                        <ul className="mt-1 space-y-2">
                          {task.files.map((file) => (
                            <li key={file.sourceId} className="flex items-start gap-1">
                              <div className="min-w-0 flex-1">
                                <p className="break-all">{file.path}</p>
                                <p
                                  className={
                                    file.state === 'failed' ? 'break-words text-red' : 'text-ink-3'
                                  }
                                >
                                  {file.error ?? fileLabels[file.state]}
                                </p>
                              </div>
                              {file.state === 'failed' && (
                                <Button
                                  disabled={busy}
                                  variant="ghost"
                                  size="icon-xs"
                                  aria-label={`重试 ${file.path}`}
                                  title="仅重试此文件"
                                  onClick={() =>
                                    void perform(() =>
                                      window.dela!.canvas.retryDownload(task.id, file.sourceId),
                                    )
                                  }
                                >
                                  <RotateCcw />
                                </Button>
                              )}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <p className="border-t border-line px-2 py-2 text-xs text-ink-3">
            同名文件覆盖保存。退出应用后不保留任务记录。
          </p>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
