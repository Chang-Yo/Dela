// @pierre/diffs 的薄封装：固定统一视图与 Shiki github 主题，明暗跟随应用根元素的 .dark。
// 它渲染在 shadow DOM 里，外观只能经 CSS 变量传入，因此这里把 Pierre 的变量映射到 design token。
import { useSyncExternalStore, type CSSProperties } from 'react';
import { parseDiffFromFile } from '@pierre/diffs';
import { FileDiff, PatchDiff, Virtualizer } from '@pierre/diffs/react';
import { FileIcon } from './view-utils';

const tokenStyle = {
  '--diffs-font-family': 'var(--font-mono)',
  '--diffs-header-font-family': 'var(--font-sans)',
  '--diffs-font-size': 'var(--text-xs)',
  '--diffs-line-height': 'calc(var(--spacing) * 5)',
  '--diffs-addition-color-override': 'var(--success)',
  '--diffs-deletion-color-override': 'var(--danger)',
  '--diffs-bg-addition-override': 'var(--success-tint)',
  '--diffs-bg-deletion-override': 'var(--danger-tint)',
  '--diffs-bg-addition-emphasis-override': 'color-mix(in srgb, var(--success) 28%, transparent)',
  '--diffs-bg-deletion-emphasis-override': 'color-mix(in srgb, var(--danger) 28%, transparent)',
  '--diffs-fg-number-override': 'var(--ink-3)',
} as CSSProperties;

const baseOptions = {
  diffStyle: 'unified',
  lineDiffType: 'word',
  disableFileHeader: true,
  theme: { light: 'github-light', dark: 'github-dark' },
} as const;

function subscribeRootClass(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  return () => observer.disconnect();
}

function useAppThemeType() {
  return useSyncExternalStore(subscribeRootClass, () =>
    document.documentElement.classList.contains('dark') ? 'dark' : 'light',
  );
}

export function PatchDiffView({ patch }: { patch: string }) {
  const themeType = useAppThemeType();
  return (
    <PatchDiff
      className="bg-surface"
      options={{ ...baseOptions, themeType }}
      patch={patch}
      style={tokenStyle}
    />
  );
}

/** 大 diff 的滚动容器：Pierre 只渲染视口附近的行，滚动由它自己的容器承担。 */
export function DiffScroller({ children }: { children: React.ReactNode }) {
  return <Virtualizer className="min-h-0 min-w-0 flex-1 overflow-auto">{children}</Virtualizer>;
}

// edit 的文本片段多半不带结尾换行，补齐后末行不会被判成改动。
const withFinalNewline = (text: string) => (text && !text.endsWith('\n') ? `${text}\n` : text);

/** 工具卡片里的单次 edit：前后文本直接对比，固定高度内滚动，失败时左侧加色条。 */
export function EditDiffCard({
  path,
  oldText,
  newText,
  failed,
}: {
  path: string;
  oldText: string;
  newText: string;
  failed: boolean;
}) {
  const themeType = useAppThemeType();
  const fileDiff = parseDiffFromFile(
    { name: path, contents: withFinalNewline(oldText) },
    { name: path, contents: withFinalNewline(newText) },
  );
  const added = fileDiff.hunks.reduce((sum, hunk) => sum + hunk.additionLines, 0);
  const deleted = fileDiff.hunks.reduce((sum, hunk) => sum + hunk.deletionLines, 0);
  return (
    <div className="relative w-full overflow-hidden rounded-card bg-surface shadow-card">
      {failed && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 z-10 w-[0.1875rem] bg-danger"
        />
      )}
      <div className="flex min-h-11 items-center gap-2 border-b border-line px-4 py-2 text-sm">
        <FileIcon path={path} />
        <span className="min-w-0 truncate font-mono leading-normal text-ink">{path}</span>
        <span className="ml-auto inline-flex shrink-0 items-center gap-2 font-mono text-xs leading-none tabular-nums">
          <span className="text-success">+{added}</span>
          <span className="text-danger">-{deleted}</span>
        </span>
      </div>
      <div className="max-h-80 overflow-y-auto">
        <FileDiff
          className="bg-surface"
          fileDiff={fileDiff}
          options={{ ...baseOptions, themeType }}
          style={tokenStyle}
        />
      </div>
    </div>
  );
}
