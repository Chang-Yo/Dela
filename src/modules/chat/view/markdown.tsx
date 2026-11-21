import 'katex/dist/katex.min.css';

import type { ComponentProps } from 'react';
import { code } from '@streamdown/code';
import { createMathPlugin } from '@streamdown/math';
import type { MermaidConfig } from '@streamdown/mermaid';
import {
  Streamdown,
  defaultTranslations,
  type ControlsConfig,
  type DiagramPlugin,
  type LinkSafetyConfig,
} from 'streamdown';
import { cn } from '../../../ui/lib/cn';
import { mermaidConfig, renderMermaid } from '../../preview/view';
import { useChatTabSource } from './chat-source';

// mermaid 本体体积大，这里只注册插件对象，首次渲染图表时才动态加载真正的库。
const lazyMermaidPlugin: DiagramPlugin = {
  name: 'mermaid',
  type: 'diagram',
  language: 'mermaid',
  getMermaid: (config?: MermaidConfig) => ({
    initialize: () => {},
    render: (id: string, chart: string) => renderMermaid(id, chart, config),
  }),
};

// 数学公式含单美元行内写法（LLM 输出惯例）；mermaid 按需加载。
// controls 用对象式配置时子项默认全开，不需要的必须显式关闭。
const chatStreamdownPlugins = {
  code,
  math: createMathPlugin({ singleDollarTextMath: true }),
  mermaid: lazyMermaidPlugin,
};

const chatControls: ControlsConfig = {
  code: { copy: true, download: false },
  table: false,
  // 全屏查看用 streamdown 内置；复制/下载用不到，显式关闭。
  mermaid: { copy: false, download: false },
  image: false,
};

// streamdown 要的是 { config } 包装；引用随明暗切换变化才会触发图表重绘。
let mermaidWrapper: { config: MermaidConfig; options: { config: MermaidConfig } } | null = null;
function mermaidOptions() {
  const config = mermaidConfig();
  if (mermaidWrapper?.config !== config) mermaidWrapper = { config, options: { config } };
  return mermaidWrapper.options;
}

const chatTranslations = {
  ...defaultTranslations,
  copyCode: '复制代码',
  copied: '已复制',
  viewFullscreen: '全屏查看',
  exitFullscreen: '退出全屏',
  zoomIn: '放大',
  zoomOut: '缩小',
  resetView: '重置视图',
};

function ChatTable({
  children,
  className,
  node: _node,
  ...props
}: ComponentProps<'table'> & { node?: unknown }) {
  return (
    <div className="my-2 w-full overflow-x-auto">
      <table className={cn('w-full text-xs', className)} {...props}>
        {children}
      </table>
    </div>
  );
}

const chatComponents = { table: ChatTable };

// 坑：容器带 content-visibility: auto 时 grid 列会塌缩；overflow-hidden 会破坏 sticky 头部。
// 写剪贴板依赖主进程放行 clipboard-sanitized-write，否则点击无反应。
const markdownStyles =
  '[&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_li]:my-1 [&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1 [&_h3]:text-sm [&_h3]:font-semibold [&_blockquote]:border-l-2 [&_blockquote]:border-line [&_blockquote]:pl-3 [&_blockquote]:text-ink-3 [&_th]:border [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_td]:border [&_td]:px-2 [&_td]:py-1 [&_code]:rounded [&_code]:bg-code [&_code]:px-1 [&_code]:py-0.5 [&_:not(pre)>code]:text-[0.85em] [&_pre]:my-2 [&_pre]:rounded-control [&_pre]:bg-code [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_.katex-display]:overflow-x-auto [&_.katex-display]:overflow-y-hidden [&_[data-streamdown=code-block]]:gap-0 [&_[data-streamdown=code-block]]:rounded-card [&_[data-streamdown=code-block]]:border-0 [&_[data-streamdown=code-block]]:bg-code [&_[data-streamdown=code-block]]:p-0 [&_[data-streamdown=code-block-header]]:sticky [&_[data-streamdown=code-block-header]]:top-0 [&_[data-streamdown=code-block-header]]:z-10 [&_[data-streamdown=code-block-header]]:justify-start [&_[data-streamdown=code-block-header]]:rounded-t-card [&_[data-streamdown=code-block-header]]:bg-code [&_[data-streamdown=code-block-header]]:px-2 [&_[data-streamdown=code-block]>div:nth-child(2)]:-mt-8 [&_[data-streamdown=code-block]>div:nth-child(2)]:pr-3 [&_[data-streamdown=code-block]>div:nth-child(2)]:top-0 [&_[data-streamdown=code-block-body]]:rounded-none [&_[data-streamdown=code-block-body]]:border-none [&_[data-streamdown=code-block-body]]:bg-transparent [&_[data-streamdown=code-block-body]]:p-0 [&_[data-streamdown=code-block-body]_pre]:my-0 [&_[data-streamdown=code-block-body]_pre]:rounded-none [&_[data-streamdown=code-block-body]_pre]:rounded-b-card [&_[data-streamdown=code-block-actions]]:opacity-0 [&_[data-streamdown=code-block-actions]]:transition-opacity [&_[data-streamdown=code-block]:focus-within_[data-streamdown=code-block-actions]]:opacity-100 [&_[data-streamdown=code-block]:hover_[data-streamdown=code-block-actions]]:opacity-100 [&_div[data-streamdown=code-block-actions]]:border-0 [&_div[data-streamdown=code-block-actions]]:bg-transparent [&_div[data-streamdown=code-block-actions]]:p-0 [&_div[data-streamdown=code-block-actions]_button[data-streamdown=code-block-copy-button]]:rounded-control [&_div[data-streamdown=code-block-actions]_button[data-streamdown=code-block-copy-button]_svg]:size-3.5 [&_div[data-streamdown=code-block-actions]_button[data-streamdown=code-block-copy-button]:hover]:bg-hover-strong [&_[data-streamdown=unordered-list]]:list-outside [&_[data-streamdown=unordered-list]]:pl-5 [&_[data-streamdown=ordered-list]]:list-outside [&_[data-streamdown=ordered-list]]:pl-5 [&_[data-streamdown=code-block-header]_span:empty::after]:content-["txt"]';

/** 聊天区 Markdown 统一入口；默认 static，仅流式中的消息启用 streaming，完成态不再经 remend 修补。 */
export function ChatMarkdown({
  children,
  className,
  mode = 'static',
  ...props
}: ComponentProps<typeof Streamdown>) {
  const { opensLink } = useChatTabSource();
  // 应用内会打开的链接（由模块认领）免外链确认：主进程会把它交回应用内阅读。
  const linkSafety: LinkSafetyConfig = { enabled: true, onLinkCheck: opensLink };
  return (
    <Streamdown
      className={cn(markdownStyles, className)}
      codeBlockMaxHeight={0}
      components={chatComponents}
      controls={chatControls}
      linkSafety={linkSafety}
      mermaid={mermaidOptions()}
      mode={mode}
      plugins={chatStreamdownPlugins}
      skipHtml
      translations={chatTranslations}
      {...props}
    >
      {children}
    </Streamdown>
  );
}
