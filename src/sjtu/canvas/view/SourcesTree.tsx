import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Archive, Columns2, Download, Ellipsis, FileText, FolderOpen, Link2 } from 'lucide-react';
import type { LibraryProps } from '../../../app/module';
import { errorMessage } from '../../../core/protocol/contract';
import { showToast } from '../../../renderer/app/toasts';
import { Explorer, type ExplorerItem } from '../../../renderer/components/explorer';
import { fileManagerName } from '../../../renderer/lib/platform';
import { ConfirmDialog } from '../../../ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../../ui/dropdown-menu';
import { IconButton } from '../../../ui/icon-button';
import { compareCanvasTerms, latestTermOf } from '../contract';
import { canvasClient, stateKey, useCanvasState, useLibraryGrouping } from './use-canvas';

export function SourcesTree({
  expanded,
  onExpand,
  onOpen,
  onOpenToSide,
  selected,
  query,
  archived,
  onArchive,
  onLink,
}: LibraryProps) {
  const queryClient = useQueryClient();
  const canvas = useCanvasState();
  const bySource = useLibraryGrouping((state) => state.bySource);
  const [loading, setLoading] = useState<number[]>([]);
  // 待确认归档的课程 id；课程对象从 canvas 现查，确认时以最新归档态为准。
  const [confirmCourseId, setConfirmCourseId] = useState<number | null>(null);
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
    if (loading.includes(id)) return;
    setLoading((ids) => [...ids, id]);
    try {
      queryClient.setQueryData(stateKey, await canvasClient.syncCourse(id));
    } catch (cause) {
      showToast({ variant: 'error', title: '同步课程资料失败', description: errorMessage(cause) });
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
        onOpenToSide={(id) => {
          const item = canvas.items.find((i) => i.id === id);
          if (item?.sourceId) onOpenToSide(`source:${item.sourceId}`);
        }}
        actions={(node) => {
          const course = canvas.courses.find((c) => `course:${c.id}` === node.id);
          const item = canvas.items.find((i) => i.id === node.id);
          const sourceId = item?.sourceId;
          if (!course && !sourceId) return null;
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton size="sm" aria-label={`${node.name} 的操作`}>
                  <Ellipsis />
                </IconButton>
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
                        className="max-w-64 break-words whitespace-pre-line px-2 py-1 text-xs text-danger"
                      >
                        {course.error}
                      </p>
                    )}
                    <DropdownMenuItem onSelect={() => setConfirmCourseId(course.id)}>
                      <Archive />
                      {course.archived ? '取消归档' : '归档'}
                    </DropdownMenuItem>
                  </>
                ) : (
                  sourceId && (
                    <>
                      <DropdownMenuItem onSelect={() => onOpen(`source:${sourceId}`)}>
                        <FileText />
                        在标签页中打开
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => onOpenToSide(`source:${sourceId}`)}>
                        <Columns2 />
                        在另一栏打开
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => onLink(`source:${sourceId}`)}>
                        <Link2 />
                        添加到项目
                      </DropdownMenuItem>
                      {item?.kind === 'file' && (
                        <>
                          <DropdownMenuItem
                            onSelect={() => {
                              void canvasClient.reveal(sourceId).catch((cause) =>
                                showToast({
                                  variant: 'error',
                                  title: `打开 ${fileManagerName} 失败`,
                                  description: errorMessage(cause),
                                }),
                              );
                            }}
                          >
                            <FolderOpen />在 {fileManagerName} 中显示
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() => {
                              void canvasClient.download(sourceId).catch((cause) =>
                                showToast({
                                  variant: 'error',
                                  title: '下载失败',
                                  description: errorMessage(cause),
                                }),
                              );
                            }}
                          >
                            <Download />
                            下载文件
                          </DropdownMenuItem>
                        </>
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
        <ConfirmDialog
          confirmLabel={confirmCourse.archived ? '取消归档' : '归档'}
          description={
            confirmCourse.archived
              ? '课程将恢复到原学期目录。'
              : '归档后将移入「归档」区，不再自动同步该课程，也不再提示同步错误。'
          }
          onConfirm={() => {
            const wasArchived = confirmCourse.archived;
            setConfirmCourseId(null);
            void canvasClient
              .archiveCourse({ id: confirmCourse.id, archived: !wasArchived })
              .then((state) => {
                queryClient.setQueryData(stateKey, state);
                if (!wasArchived) onArchive();
              })
              .catch((cause) =>
                showToast({
                  variant: 'error',
                  title: '归档课程失败',
                  description: errorMessage(cause),
                }),
              );
          }}
          onOpenChange={(open) => !open && setConfirmCourseId(null)}
          open
          title={
            confirmCourse.archived
              ? `取消归档「${confirmCourse.name}」？`
              : `归档「${confirmCourse.name}」？`
          }
        />
      )}
    </>
  );
}
