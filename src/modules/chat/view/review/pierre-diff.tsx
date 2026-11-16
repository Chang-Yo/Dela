// @pierre/diffs 的薄封装：固定统一视图与 Shiki github 主题，明暗跟随应用根元素的 .dark。
// 它渲染在 shadow DOM 里，外观只能经 CSS 变量传入，因此这里把 Pierre 的变量映射到 design token。
import { useSyncExternalStore, type CSSProperties } from 'react';
import { parseDiffFromFile } from '@pierre/diffs';
import { File, FileDiff, PatchDiff, Virtualizer } from '@pierre/diffs/react';
import { ToolCard } from '../../../../ui/agent/tool-card';
import { FileIcon } from '../../../../ui/file-icon';

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

const reviewTokenStyle = {
  ...tokenStyle,
  '--diffs-font-size': 'var(--text-sm)',
  '--diffs-line-height': 'calc(var(--spacing) * 6)',
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
      style={reviewTokenStyle}
    />
  );
}

/** 大 diff 的滚动容器：Pierre 只渲染视口附近的行，滚动由它自己的容器承担。 */
export function DiffScroller({ children }: { children: React.ReactNode }) {
  return <Virtualizer className="min-h-0 min-w-0 flex-1 overflow-auto">{children}</Virtualizer>;
}

// edit 的文本片段多半不带结尾换行，补齐后末行不会被判成改动。
const withFinalNewline = (text: string) => (text && !text.endsWith('\n') ? `${text}\n` : text);

/** 工具卡片里的 read/write：与 edit 同一套 Shiki 主题，按文件名识别语言，复制的是原文。 */
export function CodeFileCard({
  path,
  content,
  failed,
}: {
  path: string;
  content: string;
  failed: boolean;
}) {
  const themeType = useAppThemeType();
  return (
    <ToolCard
      bodyClassName="max-h-80 overflow-y-auto"
      copyText={content}
      failed={failed}
      icon={<FileIcon path={path} />}
      title={path}
    >
      <File
        className="bg-surface"
        file={{ name: path, contents: withFinalNewline(content) }}
        options={{ disableFileHeader: true, theme: baseOptions.theme, themeType }}
        style={tokenStyle}
      />
    </ToolCard>
  );
}

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
    <ToolCard
      bodyClassName="max-h-80 overflow-y-auto"
      failed={failed}
      icon={<FileIcon path={path} />}
      stats={{ added, deleted }}
      title={path}
    >
      <FileDiff
        className="bg-surface"
        fileDiff={fileDiff}
        options={{ ...baseOptions, themeType }}
        style={tokenStyle}
      />
    </ToolCard>
  );
}
