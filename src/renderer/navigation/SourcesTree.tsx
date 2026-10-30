// Canvas 资料树。
// 订阅 workspace/store 的 Canvas 概览镜像，同步/归档/下载经 preload canvas:* 通道直连。
import { useEffect, useState } from 'react';
import { AlertDialog } from 'radix-ui';
import { Archive, Columns2, Ellipsis, Download, FileText, Link2, Pin, PinOff } from 'lucide-react';
import { Button } from '../components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import { Explorer, type ExplorerItem } from '../components/ui/explorer';
import { errorText, useWorkspaceStore } from '../workspace/store';
import { showToast } from '../app/toasts';
import { compareCanvasTerms, latestTermOf } from '../../shared/canvas';
import { dialogOverlay, dialogPanel } from '../components/ui/motion';
import { cn } from '../lib/utils';

export function SourcesTree({
  expanded,
  onExpand,
  onOpen,
  onOpenToSide,
  selected,
  query,
  bySource,
  archived = false,
  onArchive,
  onLink,
}: {
  expanded: string[];
  onExpand: (id: string, open: boolean) => void;
  onOpen: (key: string) => void;
  /** 修饰键单击/菜单「在另一栏打开」时在副编辑组打开（key 为 source: 前缀键）。 */
  onOpenToSide?: (key: string) => void;
  selected: string | null;
  query: string;
  bySource: boolean;
  archived?: boolean;
  /** 课程归档成功后回调（用于展开上层「归档」区）。 */
  onArchive?: () => void;
  onLink: (key: string) => void;
}) {
  const canvas = useWorkspaceStore((s) => s.canvas);
  const [cachePins, setCachePins] = useState<{ fileIds: number[]; courseIds: number[] }>({
    fileIds: [],
    courseIds: [],
  });
  const [loading, setLoading] = useState<number[]>([]);
  // 待确认归档的课程 id；课程对象从 canvas 现查，确认时以最新归档态为准。
  const [confirmCourseId, setConfirmCourseId] = useState<number | null>(null);
  useEffect(() => {
    void window.dela?.canvas
      .getCachePins()
      .then(setCachePins)
      .catch(() => {});
  }, []);
  const confirmCourse =
    confirmCourseId === null ? undefined : canvas.courses.find((c) => c.id === confirmCourseId);
  const nodes: ExplorerItem[] = [];
  if (bySource) nodes.push({ id: 'canvas', parentId: null, name: 'Canvas', container: true });
  const terms = [...new Set(canvas.courses.map((c) => c.term))].sort(compareCanvasTerms);
  const latestTerm = latestTermOf(canvas.courses);
  const archivedTerms = new Set(
    terms.filter((term) => term === '未标注学期' || term !== latestTerm),
  );
  const visibleTerms = terms.filter((term) => archivedTerms.has(term) === archived);
  for (const term of visibleTerms)
    nodes.push({
      id: `term:${term}`,
      parentId: bySource ? 'canvas' : null,
      name: term,
      container: true,
    });
  // 「文件」根目录连同课程内子文件夹一并展示：模块没收录的文件只有这里能看到；
  // 与模块重复引用的是同一 source，打开与下载仍走同一条路。
  for (const course of canvas.courses)
    if (!course.archived)
      nodes.push({
        id: `course:${course.id}`,
        parentId: `term:${course.term}`,
        name: course.name,
        container: true,
        badge: loading.includes(course.id) ? '…' : course.error ? '!' : undefined,
      });
  // 归档课程不占用学期目录，统一移入底部「归档」区平铺展示，并在该处恢复（取消归档）。
  if (archived)
    for (const course of canvas.courses)
      if (course.archived)
        nodes.push({
          id: `course:${course.id}`,
          parentId: bySource ? 'canvas' : null,
          name: course.name,
          container: true,
        });
  for (const item of canvas.items)
    nodes.push({
      id: item.id,
      parentId: item.parentId ?? `course:${item.courseId}`,
      name: item.name,
      container: item.kind === 'folder' || item.kind === 'module',
    });
  let filtered = nodes;
  let effectiveExpanded = expanded;
  if (query.trim()) {
    const keep = new Set(
      nodes
        .filter((n) => n.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
        .map((n) => n.id),
    );
    const parents = new Map(nodes.map((n) => [n.id, n.parentId]));
    for (const id of keep) {
      let parent = parents.get(id);
      while (parent && !keep.has(parent)) {
        keep.add(parent);
        parent = parents.get(parent);
      }
    }
    filtered = nodes.filter((n) => keep.has(n.id));
    effectiveExpanded = [...keep];
  }
  const sync = async (id: number) => {
    if (!window.dela || loading.includes(id)) return;
    setLoading((ids) => [...ids, id]);
    try {
      useWorkspaceStore.getState().setCanvas(await window.dela.canvas.syncCourse(id));
    } catch (cause) {
      showToast({ variant: 'error', title: '同步课程资料失败', description: errorText(cause) });
    } finally {
      setLoading((ids) => ids.filter((value) => value !== id));
    }
  };
  const expand = (id: string, open: boolean) => {
    onExpand(id, open);
    if (open && id.startsWith('course:')) {
      const courseId = Number(id.slice(7));
      const course = canvas.courses.find((c) => c.id === courseId);
      // 已归档课程不再自动同步（令牌可能已失效），需要时可手动恢复归档后再同步。
      if (course && !course.archived && !course.syncedAt) void sync(courseId);
    }
  };
  return (
    <>
      <Explorer
        label="课程资料"
        items={filtered}
        expanded={effectiveExpanded}
        selected={canvas.items.find((i) => `source:${i.sourceId}` === selected)?.id ?? null}
        onExpand={expand}
        onOpenToSide={
          onOpenToSide &&
          ((id: string) => {
            const item = canvas.items.find((i) => i.id === id);
            if (item?.sourceId) onOpenToSide(`source:${item.sourceId}`);
          })
        }
        actions={(node) => {
          const course = canvas.courses.find((c) => `course:${c.id}` === node.id);
          const item = canvas.items.find((i) => i.id === node.id);
          const sourceId = item?.sourceId;
          if (!course && !sourceId) return null;
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="grid size-6 place-items-center rounded-chip text-ink-3 transition-colors duration-100 hover:bg-hover-2 hover:text-ink"
                  aria-label={`${node.name} 的操作`}
                >
                  <Ellipsis className="size-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {course ? (
                  <>
                    {course.syncedAt && (
                      <p className="px-2 py-1 text-xs text-ink-3">
                        更新于 {new Date(course.syncedAt).toLocaleString('zh-CN')}
                      </p>
                    )}
                    {course.error && (
                      <p
                        role="status"
                        className="max-w-64 break-words whitespace-pre-line px-2 py-1 text-xs text-red"
                      >
                        {course.error}
                      </p>
                    )}
                    <DropdownMenuItem onSelect={() => setConfirmCourseId(course.id)}>
                      <Archive />
                      {course.archived ? '取消归档' : '归档'}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => {
                        const pinned = cachePins.courseIds.includes(course.id);
                        void window.dela?.canvas
                          .setCachePin({ kind: 'course', courseId: course.id }, !pinned)
                          .then(setCachePins)
                          .catch((cause) =>
                            showToast({
                              variant: 'error',
                              title: '保存固定设置失败',
                              description: errorText(cause),
                            }),
                          );
                      }}
                    >
                      {cachePins.courseIds.includes(course.id) ? <PinOff /> : <Pin />}
                      {cachePins.courseIds.includes(course.id) ? '取消固定缓存' : '固定缓存'}
                    </DropdownMenuItem>
                  </>
                ) : (
                  sourceId && (
                    <>
                      <DropdownMenuItem onSelect={() => onOpen(`source:${sourceId}`)}>
                        <FileText />
                        在标签页中打开
                      </DropdownMenuItem>
                      {onOpenToSide && (
                        <DropdownMenuItem onSelect={() => onOpenToSide(`source:${sourceId}`)}>
                          <Columns2 />
                          在另一栏打开
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem onSelect={() => onLink(`source:${sourceId}`)}>
                        <Link2 />
                        添加到项目
                      </DropdownMenuItem>
                      {sourceId.startsWith('file:') && (
                        <DropdownMenuItem
                          onSelect={() => {
                            void window.dela?.canvas.download(sourceId).catch((cause) =>
                              showToast({
                                variant: 'error',
                                title: '下载失败',
                                description: errorText(cause),
                              }),
                            );
                          }}
                        >
                          <Download />
                          下载文件
                        </DropdownMenuItem>
                      )}
                      {sourceId.startsWith('file:') && (
                        <DropdownMenuItem
                          onSelect={() => {
                            const fileId = Number(sourceId.slice(5));
                            if (!Number.isInteger(fileId) || fileId <= 0) return;
                            const pinned = cachePins.fileIds.includes(fileId);
                            void window.dela?.canvas
                              .setCachePin({ kind: 'file', fileId }, !pinned)
                              .then(setCachePins)
                              .catch((cause) =>
                                showToast({
                                  variant: 'error',
                                  title: '保存固定设置失败',
                                  description: errorText(cause),
                                }),
                              );
                          }}
                        >
                          {cachePins.fileIds.includes(Number(sourceId.slice(5))) ? (
                            <PinOff />
                          ) : (
                            <Pin />
                          )}
                          {cachePins.fileIds.includes(Number(sourceId.slice(5)))
                            ? '取消固定缓存'
                            : '固定缓存'}
                        </DropdownMenuItem>
                      )}
                    </>
                  )
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          );
        }}
        onSelect={(id) => {
          const item = canvas.items.find((i) => i.id === id);
          if (item?.sourceId) onOpen(`source:${item.sourceId}`);
          else expand(id, !expanded.includes(id));
        }}
      />
      {query && filtered.length === 0 && (
        <p className="px-4 py-3 text-xs text-ink-3">已同步资料中没有匹配内容</p>
      )}
      {/* 确认框放在下拉菜单之外：DropdownMenuContent 关闭即卸载，挂在内层会被连同销毁。 */}
      {confirmCourse && (
        <AlertDialog.Root open onOpenChange={(open) => !open && setConfirmCourseId(null)}>
          <AlertDialog.Portal>
            <AlertDialog.Overlay className={dialogOverlay} />
            <AlertDialog.Content className={cn(dialogPanel, 'max-w-sm')}>
              <AlertDialog.Title className="text-base font-semibold">
                {confirmCourse.archived
                  ? `取消归档「${confirmCourse.name}」？`
                  : `归档「${confirmCourse.name}」？`}
              </AlertDialog.Title>
              <AlertDialog.Description className="mt-1 text-13 leading-relaxed text-ink-3">
                {confirmCourse.archived
                  ? '课程将恢复到原学期目录。'
                  : '归档后将移入「归档」区，不再自动同步该课程，也不再提示同步错误。'}
              </AlertDialog.Description>
              <div className="mt-4 flex items-center justify-end gap-2">
                <Button onClick={() => setConfirmCourseId(null)} variant="ghost">
                  取消
                </Button>
                <Button
                  onClick={() => {
                    const wasArchived = confirmCourse.archived;
                    setConfirmCourseId(null);
                    void window.dela?.canvas
                      .archiveCourse(confirmCourse.id, !wasArchived)
                      .then(useWorkspaceStore.getState().setCanvas)
                      .then(() => {
                        // 归档成功后展开底部「归档」区，让课程直接出现在归档文件夹中。
                        if (!wasArchived) onArchive?.();
                      })
                      .catch((cause) =>
                        showToast({
                          variant: 'error',
                          title: '归档课程失败',
                          description: errorText(cause),
                        }),
                      );
                  }}
                >
                  {confirmCourse.archived ? '取消归档' : '归档'}
                </Button>
              </div>
            </AlertDialog.Content>
          </AlertDialog.Portal>
        </AlertDialog.Root>
      )}
    </>
  );
}
