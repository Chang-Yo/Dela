// @pierre/diffs 的薄封装：固定统一视图与 Shiki github 主题，明暗跟随应用根元素的 .dark。
// 它渲染在 shadow DOM 里，外观只能经 CSS 变量传入，因此这里把 Pierre 的变量映射到 design token。
import { useSyncExternalStore, type CSSProperties } from 'react';
import { PatchDiff, Virtualizer } from '@pierre/diffs/react';

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
