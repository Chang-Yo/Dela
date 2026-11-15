// 按学期分组勾选课程，导出每门课「文件」目录下的全部课件到用户选择的文件夹；最低粒度为课程。
import { useState } from 'react';
import { errorMessage } from '../../../core/protocol/contract';
import { showToast } from '../../../ui/toast';
import { Button } from '../../../ui/button';
import { Checkbox } from '../../../ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../../ui/dialog';
import { Spinner } from '../../../ui/spinner';
import { groupCanvasCoursesByTerm } from '../contract';
import { canvasClient, useCanvasState } from './use-canvas';

export function CanvasExportDialog({ onClose }: { onClose: () => void }) {
  const groups = groupCanvasCoursesByTerm(useCanvasState().courses);
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
    if (exporting || selected.size === 0) return;
    setExporting(true);
    try {
      const result = await canvasClient.exportCourseFiles([...selected]);
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
      showToast({ variant: 'error', title: '批量导出失败', description: errorMessage(cause) });
    } finally {
      setExporting(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(value) => {
        if (!value && !exporting) onClose();
      }}
    >
      <DialogContent className="flex max-h-[85vh] flex-col p-5">
        <div className="grid gap-1">
          <DialogTitle className="text-sm">批量导出课件</DialogTitle>
          <DialogDescription>
            勾选要导出的课程，导出每门课「文件」目录下的全部课件；课程模块等处的重复文件不包含。
          </DialogDescription>
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
                  <Checkbox
                    checked={all}
                    disabled={exporting}
                    onChange={(event) =>
                      toggleGroup(
                        group.courses.map((course) => course.id),
                        event.target.checked,
                      )
                    }
                  />
                  {group.term}
                </label>
                {group.courses.map((course) => (
                  <label
                    className="flex items-center gap-2 rounded-control px-2 py-1 text-sm transition-colors duration-base hover:bg-hover"
                    key={course.id}
                  >
                    <Checkbox
                      checked={selected.has(course.id)}
                      disabled={exporting}
                      onChange={(event) => toggleCourse(course.id, event.target.checked)}
                    />
                    <span className="min-w-0 flex-1 truncate" title={course.name}>
                      {course.name}
                    </span>
                    {course.archived && <span className="shrink-0 text-xs text-ink-3">已归档</span>}
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
              {exporting && <Spinner />}
              导出课件
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
