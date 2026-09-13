import { useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { Explorer, type ExplorerItem } from '../../components/ui/explorer';
import { useWorkspace } from '../projects/workspace';

export function SourceList({
  expanded,
  onExpand,
  onOpen,
  selected,
  query,
  bySource,
  archived = false,
}: {
  expanded: string[];
  onExpand: (id: string, open: boolean) => void;
  onOpen: (key: string) => void;
  selected: string | null;
  query: string;
  bySource: boolean;
  archived?: boolean;
}) {
  const canvas = useWorkspace((s) => s.canvas);
  const [loading, setLoading] = useState<number[]>([]);
  const [selectedCourse, setSelectedCourse] = useState<number | null>(null);
  const nodes: ExplorerItem[] = [];
  if (bySource) nodes.push({ id: 'canvas', parentId: null, name: 'Canvas', container: true });
  const terms = [...new Set(canvas.courses.map((c) => c.term))].sort((a, b) => b.localeCompare(a));
  const latestTerm = terms.find((term) => term !== '未标注学期');
  const archivedTerms = new Set(
    terms.filter((term) => term !== '未标注学期' && term !== latestTerm),
  );
  const visibleTerms = terms.filter((term) => archivedTerms.has(term) === archived);
  for (const term of visibleTerms)
    nodes.push({
      id: `term:${term}`,
      parentId: bySource ? 'canvas' : null,
      name: term,
      container: true,
    });
  for (const course of canvas.courses)
    nodes.push({
      id: `course:${course.id}`,
      parentId: `term:${course.term}`,
      name: course.name,
      container: true,
      badge: loading.includes(course.id) ? '…' : course.error ? '!' : undefined,
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
      setSelectedCourse(courseId);
      if (!canvas.courses.find((c) => c.id === courseId)?.syncedAt) void sync(courseId);
    }
  };
  const course = canvas.courses.find((c) => c.id === selectedCourse);
  return (
    <>
      <Explorer
        label="课程资料"
        items={filtered}
        expanded={effectiveExpanded}
        selected={canvas.items.find((i) => `source:${i.sourceId}` === selected)?.id ?? null}
        onExpand={expand}
        onSelect={(id) => {
          const item = canvas.items.find((i) => i.id === id);
          if (item?.sourceId) onOpen(`source:${item.sourceId}`);
          else expand(id, !expanded.includes(id));
        }}
      />
      {query && filtered.length === 0 && (
        <p className="px-4 py-3 text-xs text-muted-foreground">已同步资料中没有匹配内容</p>
      )}
      {course && (
        <div className="mx-3 mb-3 border-t pt-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate">{course.name}</span>
            <button
              className="shrink-0 hover:text-foreground"
              disabled={loading.includes(course.id)}
              onClick={() => void sync(course.id)}
              type="button"
            >
              {loading.includes(course.id) ? (
                <LoaderCircle className="size-3 animate-spin" />
              ) : (
                '刷新课程'
              )}
            </button>
          </div>
          {course.error && (
            <p role="status" className="mt-2 whitespace-pre-line text-destructive">
              {course.error}
            </p>
          )}
          {course.syncedAt && (
            <p className="mt-2">更新于 {new Date(course.syncedAt).toLocaleString('zh-CN')}</p>
          )}
        </div>
      )}
    </>
  );
}
