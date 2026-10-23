// 批量导出课件：按学期分组勾选课程，导出每门课「文件」目录下的全部课件到用户选择的文件夹；
// 最低粒度为课程，目录树数据来自 workspace/store 的 Canvas 镜像。
import { useMemo, useState } from 'react';
import { Dialog } from 'radix-ui';
import { Loader2 } from 'lucide-react';
import { Button } from '../components/ui/button';
import { dialogOverlay, dialogPanel } from '../components/ui/motion';
import { errorText, useWorkspaceStore } from '../workspace/store';
import { showToast } from '../app/toasts';
import { groupCanvasCoursesByTerm } from '../../shared/canvas';
import { cn } from '../lib/utils';

const checkboxClass = 'size-3.5 accent-[var(--ink-2)]';

export function CanvasExportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const canvas = useWorkspaceStore((s) => s.canvas);
  const groups = useMemo(() => groupCanvasCoursesByTerm(canvas.courses), [canvas.courses]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [exporting, setExporting] = useState(false);

  const toggleCourse = (id: number, on: boolean) =>
    setSelected((previous) => {
      const next = new Set(previous);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const toggleGroup = (ids: number[], on: boolean) =>
    setSelected((previous) => {
      const next = new Set(previous);
      for (const id of ids)
        if (on) next.add(id);
        else next.delete(id);
      return next;
    });

  const exportSelected = async () => {
    if (!window.dela || exporting || selected.size === 0) return;
    setExporting(true);
    try {
      const result = await window.dela.canvas.exportCourseFiles([...selected]);
      // 取消选择目录（null）不算结果：弹窗保持打开，用户可重选。
      if (result) {
        showToast({
          variant: result.failed.length ? 'error' : 'success',
          title: result.failed.length ? '课件导出部分失败' : '课件导出完成',
          description:
            `${result.exported} 个文件已导出到 ${result.dir}` +
            (result.failed.length
              ? `；失败 ${result.failed.length} 项：${result.failed[0]}${result.failed.length > 1 ? ' 等' : ''}`
              : ''),
        });
        onClose();
      }
    } catch (cause) {
      showToast({ variant: 'error', title: '批量导出失败', description: errorText(cause) });
    } finally {
      setExporting(false);
    }
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        if (!value && !exporting) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlay} />
        <Dialog.Content className={cn(dialogPanel, 'flex max-h-[85vh] max-w-md flex-col p-5')}>
          <div className="grid gap-1">
            <Dialog.Title className="text-13 font-semibold">批量导出课件</Dialog.Title>
            <Dialog.Description className="text-xs leading-relaxed text-ink-3">
              勾选要导出的课程，导出每门课「文件」目录下的全部课件；课程模块等处的重复文件不包含。
            </Dialog.Description>
          </div>
          <div className="mt-3 grid min-h-0 flex-1 content-start gap-3 overflow-y-auto pr-1">
            {groups.length === 0 && (
              <p className="px-2 py-4 text-xs text-ink-3">还没有同步到任何课程。</p>
            )}
            {groups.map((group) => {
              const all = group.courses.every((course) => selected.has(course.id));
              return (
                <div className="grid gap-0.5" key={group.term}>
                  <label className="flex items-center gap-2 px-2 py-1 text-xs font-medium text-ink-2">
                    <input
                      checked={all}
                      className={checkboxClass}
                      disabled={exporting}
                      onChange={(event) =>
                        toggleGroup(
                          group.courses.map((course) => course.id),
                          event.target.checked,
                        )
                      }
                      type="checkbox"
                    />
                    {group.term}
                  </label>
                  {group.courses.map((course) => (
                    <label
                      className="flex items-center gap-2 rounded-control px-2 py-1 text-13 transition-colors duration-150 hover:bg-hover"
                      key={course.id}
                    >
                      <input
                        checked={selected.has(course.id)}
                        className={checkboxClass}
                        disabled={exporting}
                        onChange={(event) => toggleCourse(course.id, event.target.checked)}
                        type="checkbox"
                      />
                      <span className="min-w-0 flex-1 truncate" title={course.name}>
                        {course.name}
                      </span>
                      {course.archived && (
                        <span className="shrink-0 text-2xs text-ink-3">已归档</span>
                      )}
                    </label>
                  ))}
                </div>
              );
            })}
          </div>
          <div className="mt-4 flex shrink-0 items-center justify-between gap-2">
            <span className="text-xs text-ink-3">已选 {selected.size} 门课程</span>
            <div className="flex items-center gap-2">
              <Button disabled={exporting} onClick={onClose} size="sm" variant="ghost">
                取消
              </Button>
              <Button
                disabled={exporting || selected.size === 0}
                onClick={() => void exportSelected()}
                size="sm"
              >
                {exporting && <Loader2 className="animate-spin" aria-hidden="true" />}
                导出课件
              </Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
