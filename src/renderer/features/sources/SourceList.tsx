import { useState } from 'react';
import { Archive, Columns2, Ellipsis, Download, FileText, Link2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import { Explorer, type ExplorerItem } from '../../components/ui/explorer';
import { useWorkspace } from '../projects/workspace';

// 学期按名称降序取第一个非"未标注学期"，作为默认展开/刷新的"最新学期"。
export function latestTermOf(courses: { term: string }[]): string | undefined {
  return [...new Set(courses.map((c) => c.term))]
    .sort((a, b) => b.localeCompare(a))
    .find((term) => term !== '未标注学期');
}

export function SourceList({
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
  const canvas = useWorkspace((s) => s.canvas);
  const [loading, setLoading] = useState<number[]>([]);
  const nodes: ExplorerItem[] = [];
  if (bySource) nodes.push({ id: 'canvas', parentId: null, name: 'Canvas', container: true });
  const terms = [...new Set(canvas.courses.map((c) => c.term))].sort((a, b) => b.localeCompare(a));
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
  // 各课程内的「文件」根目录是全部文件的平铺集合，与模块等组织视图重复；本地不展示。
  const fileRoots = new Set(canvas.courses.map((c) => `${c.id}:files`));
  const parentOfItem = new Map(canvas.items.map((item) => [item.id, item.parentId]));
  const inFlatFiles = (item: (typeof canvas.items)[number]) => {
    if (fileRoots.has(item.id)) return true;
    for (let id: string | null | undefined = item.parentId; id; id = parentOfItem.get(id))
      if (fileRoots.has(id)) return true;
    return false;
  };
  const shownItems = canvas.items.filter((item) => !inFlatFiles(item));
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
  for (const item of shownItems)
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
      useWorkspace.getState().setCanvas(await window.dela.canvas.syncCourse(id));
    } catch (error) {
      useWorkspace.getState().setError(error);
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
                  className="grid size-6 place-items-center rounded hover:bg-muted"
                  aria-label={`${node.name} 的操作`}
                >
                  <Ellipsis className="size-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {course ? (
                  <>
                    {course.syncedAt && (
                      <p className="px-2 py-1 text-xs text-muted-foreground">
                        更新于 {new Date(course.syncedAt).toLocaleString('zh-CN')}
                      </p>
                    )}
                    {course.error && (
                      <p
                        role="status"
                        className="max-w-64 break-words whitespace-pre-line px-2 py-1 text-xs text-destructive"
                      >
                        {course.error}
                      </p>
                    )}
                    <DropdownMenuItem
                      onSelect={() => {
                        const message = course.archived
                          ? `取消归档「${course.name}」？课程将恢复到原学期目录。`
                          : `归档「${course.name}」？归档后将移入「归档」区，不再自动同步该课程，也不再提示同步错误。`;
                        if (!window.confirm(message)) return;
                        const wasArchived = course.archived;
                        void window.dela?.canvas
                          .archiveCourse(course.id, !wasArchived)
                          .then(useWorkspace.getState().setCanvas)
                          .then(() => {
                            // 归档成功后展开底部「归档」区，让课程直接出现在归档文件夹中。
                            if (!wasArchived) onArchive?.();
                          })
                          .catch(useWorkspace.getState().setError);
                      }}
                    >
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
                      {onOpenToSide && (
                        <DropdownMenuItem onSelect={() => onOpenToSide(`source:${sourceId}`)}>
                          <Columns2 />
                          在另一栏打开
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem onSelect={() => onLink(`source:${sourceId}`)}>
                        <Link2 />
                        加入文件夹或项目
                      </DropdownMenuItem>
                      {sourceId.startsWith('file:') && (
                        <DropdownMenuItem
                          onSelect={() => {
                            void window.dela?.canvas
                              .download(sourceId)
                              .catch(useWorkspace.getState().setError);
                          }}
                        >
                          <Download />
                          下载文件
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
        <p className="px-4 py-3 text-xs text-muted-foreground">已同步资料中没有匹配内容</p>
      )}
    </>
  );
}
