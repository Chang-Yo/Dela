import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { ExternalLink, FileDown, Loader2, Presentation, RefreshCw } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { showToast } from '../../app/toasts';
import { errorText } from '../../workspace/store';
import type {
  OfficeExportEvent,
  OfficeExportInfo,
  OfficeExportProgress,
} from '../../../shared/api';
import type { ResourceRef } from '../../../shared/resources';

function progressText(progress: OfficeExportProgress | null, opening = false): string {
  if (opening) return '导出完成，正在打开…';
  if (!progress) return '正在导出，可能需要几十秒…';
  if (progress.phase === 'preparing') return '准备文件…';
  if (progress.phase === 'converting') return '正在调用 PowerPoint 转换…';
  const bytes = progress.bytes ?? 0;
  const size =
    bytes >= 1024 * 1024
      ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
      : `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `正在写入 PDF（${size}）…`;
}

const exportKey = (ref: ResourceRef) =>
  'id' in ref ? `${ref.type}:${ref.id}` : `${ref.type}:${ref.messageId}:${ref.part}`;

interface OfficeExportRun {
  progress: OfficeExportProgress | null;
  startedAt: number;
  /** 导出进程已成功退出，等文档重读翻转到 PDF 渲染。 */
  opening: boolean;
  /** 非空表示上次导出失败；保留到再次发起，切走又切回仍能看到失败原因。 */
  error: string;
}

/* 导出状态放模块级 store：切标签页会卸载组件，但导出仍在后台进行，回来要能看到进行中状态。 */
const useOfficeExports = create<{
  runs: Record<string, OfficeExportRun>;
  start: (ref: ResourceRef, onExported?: () => void) => void;
}>((set) => ({
  runs: {},
  start: (ref, onExported) => {
    const key = exportKey(ref);
    const current = useOfficeExports.getState().runs[key];
    if (current && !current.error) return;
    set((state) => ({
      runs: {
        ...state.runs,
        [key]: { progress: null, startedAt: Date.now(), opening: false, error: '' },
      },
    }));
    window.dela?.workspace.exportOfficePdf(ref).then(
      // PowerShell 退出码 0 且输出文件存在即成功；这里保持动画直到重读翻转到 PDF，
      // 避免闪回按钮被误点而触发重复导出。
      async () => {
        set((state) => {
          const run = state.runs[key];
          if (!run) return state;
          return { runs: { ...state.runs, [key]: { ...run, opening: true } } };
        });
        try {
          await onExported?.();
        } catch {
          /* 重读失败已在 PreviewTab 经浮窗提示；这里吞掉异常保证导出状态被清理 */
        }
        set((state) => {
          const runs = { ...state.runs };
          delete runs[key];
          return { runs };
        });
      },
      (cause) => {
        const message = errorText(cause);
        set((state) => {
          const run = state.runs[key];
          if (!run) return state;
          return { runs: { ...state.runs, [key]: { ...run, error: message } } };
        });
      },
    );
  },
}));

// 组件外常驻订阅：卸载期间到达的进度事件不丢，重挂载即恢复显示（按 ref 归属，并发导出互不串扰）。
if (typeof window !== 'undefined' && window.dela)
  window.dela.workspace.onOfficeExportProgress((event: OfficeExportEvent) => {
    const key = exportKey(event.ref);
    useOfficeExports.setState((state) => {
      const run = state.runs[key];
      if (!run) return state;
      return { runs: { ...state.runs, [key]: { ...run, progress: event } } };
    });
  });

function useOfficeExport(ref: ResourceRef | undefined, onExported: (() => void) | undefined) {
  const supported = window.dela?.platform === 'win32';
  const active = useOfficeExports((state) => (ref ? state.runs[exportKey(ref)] : undefined));
  const exporting = !!active && !active.error;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!exporting) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [exporting]);
  const elapsed = active ? Math.max(0, Math.round((now - active.startedAt) / 1000)) : 0;
  const run = () => {
    if (supported && ref && window.dela) useOfficeExports.getState().start(ref, onExported);
  };
  return {
    supported,
    exporting,
    opening: active?.opening ?? false,
    error: active?.error ?? '',
    run,
    progress: active?.progress ?? null,
    elapsed,
  };
}

export interface OfficePromptProps {
  title: string;
  officeRef: ResourceRef | undefined;
  onExported: (() => void) | undefined;
}

/** pptx 的确认卡片：Windows 经 PowerPoint 导出 PDF 预览，需用户主动触发；
 *  也可以不经导出，直接用系统默认应用（如 PowerPoint）打开原文件。 */
export function OfficePromptCard({ title, officeRef, onExported }: OfficePromptProps) {
  const { supported, exporting, opening, error, run, progress, elapsed } = useOfficeExport(
    officeRef,
    onExported,
  );
  const openExternally = () => {
    if (!officeRef) return;
    window.dela?.workspace.openResourceFile(officeRef).catch((cause) =>
      showToast({
        variant: 'error',
        title: '打开失败',
        description: errorText(cause),
      }),
    );
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <Presentation className="size-10 text-ink-3" aria-hidden />
      <div>
        <p className="text-13 font-medium">{title}</p>
        <p className="mt-1 text-xs text-ink-3">PowerPoint 演示文稿 · 只读，应用内不直接渲染</p>
      </div>
      {!supported && (
        <p className="max-w-md text-xs text-ink-3">
          你可以用系统默认应用打开原文件。当前平台不提供 PPTX 转 PDF，也可以导入已转换的 PDF 阅读。
        </p>
      )}
      {exporting ? (
        <div role="status" className="flex flex-col items-center gap-1 text-xs text-ink-3">
          <Loader2 aria-hidden className="size-5 animate-spin" />
          <span>{progressText(progress, opening)}</span>
          {!opening && <span className="text-2xs">已进行 {elapsed} 秒</span>}
        </div>
      ) : (
        <div className="flex items-center gap-2">
          {supported && (
            <Button size="sm" onClick={run}>
              <FileDown aria-hidden />
              导出为 PDF 预览
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={openExternally}>
            <ExternalLink aria-hidden />
            在外部打开
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="max-w-md break-words text-xs text-red">
          {error}
        </p>
      )}
    </div>
  );
}

/** 已建立导出关联时的提示：内容未过期时收纳为紧凑的重导出入口，过期/出错才完整展示警示条。 */
export function OfficeExportBanner({
  exported,
  officeRef,
  onExported,
}: Omit<OfficePromptProps, 'title'> & { exported: OfficeExportInfo }) {
  const { supported, exporting, opening, error, run, progress } = useOfficeExport(
    officeRef,
    onExported,
  );
  if (!exported.stale) {
    if (!supported) return null;
    return (
      <div className="flex shrink-0 items-center justify-end gap-2 px-2 pt-1 text-2xs">
        {error && (
          <span role="alert" className="text-red">
            {error}
          </span>
        )}
        <Button size="sm" variant="ghost" onClick={run} disabled={exporting}>
          {exporting ? <Loader2 aria-hidden className="animate-spin" /> : <RefreshCw aria-hidden />}
          {exporting ? progressText(progress, opening) : '重新导出'}
        </Button>
      </div>
    );
  }
  return (
    <div
      role="status"
      className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-1 text-2xs text-ink-3"
    >
      <span>已打开导出的 {exported.title}</span>
      <span className="text-ink">源文件在导出后更新过，内容可能过期</span>
      {supported ? (
        <Button size="sm" variant="ghost" onClick={run} disabled={exporting}>
          {exporting ? <Loader2 aria-hidden className="animate-spin" /> : <RefreshCw aria-hidden />}
          {exporting ? progressText(progress, opening) : '重新导出'}
        </Button>
      ) : (
        <span>当前平台暂不支持重新导出</span>
      )}
      {error && (
        <span role="alert" className="text-red">
          {error}
        </span>
      )}
    </div>
  );
}
