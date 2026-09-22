import 'katex/dist/katex.min.css';

import type { ComponentProps } from 'react';
import { createCodePlugin } from '@streamdown/code';
import { createMathPlugin } from '@streamdown/math';
import type { MermaidConfig } from '@streamdown/mermaid';
import {
  Streamdown,
  defaultTranslations,
  type ControlsConfig,
  type DiagramPlugin,
} from 'streamdown';
import { cn } from '../../lib/utils';

// mermaid 本体体积大，这里只注册插件对象，首次渲染图表时才动态加载真正的库。
const lazyMermaidPlugin: DiagramPlugin = {
  name: 'mermaid',
  type: 'diagram',
  language: 'mermaid',
  getMermaid: (config?: MermaidConfig) => ({
    initialize: () => {},
    render: async (id: string, chart: string) => {
      const { mermaid } = await import('@streamdown/mermaid');
      return mermaid.getMermaid(config).render(id, chart);
    },
  }),
};

/**
 * 聊天区 Markdown 渲染的共享配置。
 * 代码高亮用 shiki 双主题（与编辑器一致的 GitHub 配色）跟随明暗；
 * 数学公式启用 KaTeX（含单美元行内公式，LLM 输出惯例）；
 * mermaid 图表按需加载；对象式 controls 的子项默认开启，download 需显式关闭。
 */
const chatStreamdownPlugins = {
  code: createCodePlugin({ themes: ['github-light', 'github-dark'] }),
  math: createMathPlugin({ singleDollarTextMath: true }),
  mermaid: lazyMermaidPlugin,
};

const chatControls: ControlsConfig = {
  code: { copy: true, download: false },
  table: false,
  mermaid: false,
  image: false,
};

// mermaid 只在初始化时读主题；配置对象按当前明暗缓存，主题切换时引用变化触发图表重绘。
let mermaidTheme: { dark: boolean; options: { config: MermaidConfig } } | null = null;
function mermaidOptions() {
  const dark = document.documentElement.classList.contains('dark');
  if (!mermaidTheme || mermaidTheme.dark !== dark) {
    mermaidTheme = { dark, options: { config: { theme: dark ? 'dark' : 'default' } } };
  }
  return mermaidTheme.options;
}

const chatTranslations = { ...defaultTranslations, copyCode: '复制代码', copied: '已复制' };

/** 表格不套 streamdown 默认的卡片容器与双层边框：原生表格，超宽时横向滚动。 */
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

/**
 * 聊天区消息体的 Markdown 版式（聊天气泡、回答、工作过程说明共用）。
 * 代码块：容器 chrome 由 pre 自带背景接管；头部用 grid 把语言标签与复制按钮并到右上角
 * （复制按钮悬浮显示，sticky 跟随长代码块滚动）；滚动条都在 body 的可视窗口边缘，
 * 不再挂在内容底部。公式超宽时横向滚动。
 */
const markdownStyles =
  '[&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_li]:my-1 [&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1 [&_h3]:text-sm [&_h3]:font-semibold [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_th]:border [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_td]:border [&_td]:px-2 [&_td]:py-1 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.85em] [&_pre]:my-2 [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_.katex-display]:overflow-x-auto [&_.katex-display]:overflow-y-hidden [&_[data-streamdown=code-block]]:grid [&_[data-streamdown=code-block]]:grid-cols-[1fr_auto] [&_[data-streamdown=code-block]]:rounded-none [&_[data-streamdown=code-block]]:border-none [&_[data-streamdown=code-block]]:bg-transparent [&_[data-streamdown=code-block]]:p-0 [&_[data-streamdown=code-block-header]]:justify-end [&_[data-streamdown=code-block]>div:nth-child(2)]:col-start-2 [&_[data-streamdown=code-block]>div:nth-child(2)]:row-start-1 [&_[data-streamdown=code-block]>div:nth-child(2)]:row-span-2 [&_[data-streamdown=code-block]>div:nth-child(2)]:mt-0 [&_[data-streamdown=code-block-body]]:col-span-2 [&_[data-streamdown=code-block-body]]:rounded-none [&_[data-streamdown=code-block-body]]:border-none [&_[data-streamdown=code-block-body]]:bg-transparent [&_[data-streamdown=code-block-body]]:p-0 [&_[data-streamdown=code-block-actions]]:opacity-0 [&_[data-streamdown=code-block-actions]]:transition-opacity [&_[data-streamdown=code-block]:focus-within_[data-streamdown=code-block-actions]]:opacity-100 [&_[data-streamdown=code-block]:hover_[data-streamdown=code-block-actions]]:opacity-100 [&_[data-streamdown=unordered-list]]:list-outside [&_[data-streamdown=unordered-list]]:pl-5 [&_[data-streamdown=ordered-list]]:list-outside [&_[data-streamdown=ordered-list]]:pl-5';

/** 聊天区 Markdown 统一入口：插件、控件、表格组件与文案只在此配置一次。 */
export function ChatMarkdown({ children, className, ...props }: ComponentProps<typeof Streamdown>) {
  return (
    <Streamdown
      className={cn(markdownStyles, className)}
      components={chatComponents}
      controls={chatControls}
      mermaid={mermaidOptions()}
      plugins={chatStreamdownPlugins}
      skipHtml
      translations={chatTranslations}
      {...props}
    >
      {children}
    </Streamdown>
  );
}
