import {
  ChevronRight,
  Clock,
  Code,
  Eye,
  FolderOpen,
  LoaderCircle,
  PenLine,
  RefreshCw,
} from 'lucide-react';
import { Button } from '../../components/ui/button';
import { cn } from '../../lib/utils';

/** 笔记编辑模式（本次会话内按文档记忆；含 frontmatter 等不支持语法的文档强制源码模式）。 */
export type NoteMode = 'rich' | 'read' | 'source';

/**
 * 笔记内容级工具栏（自 ProjectDocument 工具栏拆出）：保存状态低干扰展示、格式/源码
 * 切换、文件夹定位与重载。正常状态不常驻保存按钮（计划 §4.3：自动保存已覆盖该路径），
 * 失败重试与「另存为新笔记」入口在 NoteTab 的错误条中提供。
 */
export function DocumentToolbar({
  path,
  markdown,
  forcedSource,
  mode,
  onModeChange,
  saving,
  dirty,
  failed,
  dueAt,
  onOpenInFolder,
  onReload,
}: {
  path: string[];
  /** Markdown 笔记才有富文本/阅读/源码切换；纯文本笔记始终是源码编辑器。 */
  markdown: boolean;
  /** frontmatter 等语法强制源码模式，切换入口整体隐藏。 */
  forcedSource: boolean;
  mode: NoteMode;
  onModeChange: (mode: NoteMode) => void;
  saving: boolean;
  dirty: boolean;
  /** 保存失败时状态文字转警示色（详情在错误条）。 */
  failed: boolean;
  dueAt?: string | null;
  onOpenInFolder: () => void;
  onReload: () => void;
}) {
  return (
    <div
      className="flex min-w-0 shrink-0 items-center gap-2 px-3 py-1.5 text-xs"
      role="toolbar"
      aria-label="笔记操作"
    >
      <nav
        aria-label="文件路径"
        className="min-w-0 flex-1 text-muted-foreground"
        title={path.join(' / ')}
      >
        <ol className="flex min-w-0 items-center gap-1 overflow-hidden">
          {path.map((name, index) => (
            <li key={index} className="flex min-w-0 items-center gap-1 last:text-foreground/80">
              {index > 0 && <ChevronRight aria-hidden className="size-3 shrink-0" />}
              <span
                className="truncate"
                aria-current={index === path.length - 1 ? 'page' : undefined}
              >
                {name}
              </span>
            </li>
          ))}
        </ol>
      </nav>
      {dueAt && (
        <span
          className="flex min-w-0 shrink items-center gap-1 text-muted-foreground"
          title={`截止 ${new Date(dueAt).toLocaleString('zh-CN')}`}
        >
          <Clock className="size-3 shrink-0" />
          <span className="max-w-40 truncate">截止 {new Date(dueAt).toLocaleString('zh-CN')}</span>
        </span>
      )}
      <span
        className={cn(
          'flex shrink-0 items-center gap-1 text-muted-foreground',
          failed && 'text-destructive',
        )}
        role="status"
        aria-live="polite"
      >
        {saving ? (
          <>
            <LoaderCircle className="size-3 animate-spin" />
            保存中…
          </>
        ) : dirty ? (
          '未保存'
        ) : (
          /* 正常态不常驻「已保存」图标：长期占位无信息增量；失败详情由 NoteTab 错误条承载。 */
          null
        )}
      </span>
      {markdown && !forcedSource && (
        <div className="flex shrink-0 items-center gap-0.5">
          {mode !== 'source' && (
            <Button
              size="icon-xs"
              variant="ghost"
              title={mode === 'read' ? '编辑' : '阅读模式'}
              aria-label={mode === 'read' ? '编辑' : '阅读模式'}
              onClick={() => onModeChange(mode === 'read' ? 'rich' : 'read')}
            >
              {mode === 'read' ? <PenLine /> : <Eye />}
            </Button>
          )}
          <Button
            size="icon-xs"
            variant={mode === 'source' ? 'secondary' : 'ghost'}
            title={mode === 'source' ? '返回所见即所得' : '源码模式'}
            aria-label={mode === 'source' ? '返回所见即所得' : '源码模式'}
            aria-pressed={mode === 'source'}
            onClick={() => onModeChange(mode === 'source' ? 'rich' : 'source')}
          >
            <Code />
          </Button>
        </div>
      )}
      <div className="flex shrink-0 items-center gap-0.5">
        <Button
          size="icon-xs"
          variant="ghost"
          title="在文件夹中显示"
          aria-label="在文件夹中显示"
          onClick={onOpenInFolder}
        >
          <FolderOpen />
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          title="重新载入"
          aria-label="重新载入"
          onClick={onReload}
        >
          <RefreshCw />
        </Button>
      </div>
    </div>
  );
}
