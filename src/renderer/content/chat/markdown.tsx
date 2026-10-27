import 'katex/dist/katex.min.css';

import type { ComponentProps } from 'react';
import ayuDark from '@shikijs/themes/ayu-dark';
import { createCodePlugin } from '@streamdown/code';
import { createMathPlugin } from '@streamdown/math';
import type { MermaidConfig } from '@streamdown/mermaid';
import {
  Streamdown,
  defaultTranslations,
  type ControlsConfig,
  type DiagramPlugin,
  type LinkSafetyConfig,
} from 'streamdown';
import { shuiyuanTopicFromUrl } from '../../../shared/shuiyuan';
import { cn } from '../../lib/utils';
import { mermaidConfig, renderMermaid } from '../../lib/mermaid';

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

/** 代码高亮沿用 Ayu Dark 的作用域规则，色值经 colorReplacements 换成随明暗翻转的 --syntax-* 变量：
 *  明暗两个槽位用同一主题，配色与编辑器、预览完全一致。 */
const syntaxRoles: Record<string, string> = {
  '#10141c': 'var(--syntax-bg)',
  '#bfbdb6': 'var(--syntax-fg)',
  '#bfbdb6b3': 'color-mix(in srgb, var(--syntax-fg) 70%, transparent)',
  '#ff8f40': 'var(--syntax-keyword)',
  '#aad94c': 'var(--syntax-string)',
  '#95e6cb': 'var(--syntax-regexp)',
  '#d2a6ff': 'var(--syntax-constant)',
  '#c594c5': 'var(--syntax-constant)',
  '#ffb454': 'var(--syntax-function)',
  '#59c2ff': 'var(--syntax-entity)',
  '#39bae6': 'var(--syntax-tag)',
  '#39bae680': 'color-mix(in srgb, var(--syntax-tag) 50%, transparent)',
  '#f07178': 'var(--syntax-markup)',
  '#f29668': 'var(--syntax-operator)',
  '#e6c08a': 'var(--syntax-special)',
  '#5a6673': 'var(--syntax-comment)',
  '#70bf56': 'var(--syntax-added)',
  '#73b8ff': 'var(--syntax-modified)',
  '#f26d78': 'var(--syntax-removed)',
  '#d95757': 'var(--syntax-error)',
};
const syntaxTheme = { ...ayuDark, name: 'dela-syntax', colorReplacements: syntaxRoles };

/**
 * 聊天区 Markdown 渲染的共享配置：代码高亮见 syntaxTheme；
 * 数学公式启用 KaTeX（含单美元行内公式，LLM 输出惯例）；mermaid 按需加载（全屏查看见 chatControls）。
 * controls 走对象式配置时子项默认全开，不需要的必须显式关闭。
 */
const chatStreamdownPlugins = {
  code: createCodePlugin({ themes: [syntaxTheme, syntaxTheme] }),
  math: createMathPlugin({ singleDollarTextMath: true }),
  mermaid: lazyMermaidPlugin,
};

const chatControls: ControlsConfig = {
  code: { copy: true, download: false },
  table: false,
  // mermaid：streamdown 内置全屏查看默认开启——块右上角按钮进入 portal 全屏
  // （拖拽平移、滚轮/按钮缩放、Esc 退出），无需自研；复制/下载按钮用不到，显式关闭。
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

// 水源主题链接免外链确认：主进程会把它交回应用内阅读。
const chatLinkSafety: LinkSafetyConfig = {
  enabled: true,
  onLinkCheck: (url) => shuiyuanTopicFromUrl(url) !== null,
};

/**
 * 聊天区消息体的 Markdown 版式（聊天气泡、回答、工作过程说明共用）。
 * 代码块参照 DeepSeek 网页版的无界一体化卡片：无边框、头部与代码之间无分隔线，头部 sticky
 * 钉在块顶；复制按钮自带的底色胶囊与卡片不搭，压成纯图标（常态透明、悬浮显色，点击后由
 * streamdown 换成 check）。
 * 坑：容器带 content-visibility: auto 时 grid 列会塌缩（实测复现），故不用 grid 重排；
 * overflow-hidden 会破坏 sticky，圆角改由 header/pre 分担；复制按钮靠 -mt-8 叠加对齐头部行。
 * 写剪贴板依赖主进程放行 clipboard-sanitized-write，否则点击无任何反应。
 * codeBlockMaxHeight=0：块内不出现自己的滚动条（默认 400px 内滚会在钉住头部右上露出滚动条与内容）。
 * 无语言围栏时 streamdown 渲染空 span，头部标签以 :after 兜底 txt；公式超宽时横向滚动。
 */
const markdownStyles =
  '[&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_li]:my-1 [&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1 [&_h3]:text-sm [&_h3]:font-semibold [&_blockquote]:border-l-2 [&_blockquote]:border-line [&_blockquote]:pl-3 [&_blockquote]:text-ink-3 [&_th]:border [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_td]:border [&_td]:px-2 [&_td]:py-1 [&_code]:rounded [&_code]:bg-code [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.85em] [&_pre]:my-2 [&_pre]:rounded-control [&_pre]:bg-code [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_.katex-display]:overflow-x-auto [&_.katex-display]:overflow-y-hidden [&_[data-streamdown=code-block]]:gap-0 [&_[data-streamdown=code-block]]:rounded-card [&_[data-streamdown=code-block]]:border-0 [&_[data-streamdown=code-block]]:bg-code [&_[data-streamdown=code-block]]:p-0 [&_[data-streamdown=code-block-header]]:sticky [&_[data-streamdown=code-block-header]]:top-0 [&_[data-streamdown=code-block-header]]:z-10 [&_[data-streamdown=code-block-header]]:justify-start [&_[data-streamdown=code-block-header]]:rounded-t-lg [&_[data-streamdown=code-block-header]]:bg-code [&_[data-streamdown=code-block-header]]:px-2 [&_[data-streamdown=code-block]>div:nth-child(2)]:-mt-8 [&_[data-streamdown=code-block]>div:nth-child(2)]:pr-3 [&_[data-streamdown=code-block]>div:nth-child(2)]:top-0 [&_[data-streamdown=code-block-body]]:rounded-none [&_[data-streamdown=code-block-body]]:border-none [&_[data-streamdown=code-block-body]]:bg-transparent [&_[data-streamdown=code-block-body]]:p-0 [&_[data-streamdown=code-block-body]_pre]:my-0 [&_[data-streamdown=code-block-body]_pre]:rounded-none [&_[data-streamdown=code-block-body]_pre]:rounded-b-lg [&_[data-streamdown=code-block-actions]]:opacity-0 [&_[data-streamdown=code-block-actions]]:transition-opacity [&_[data-streamdown=code-block]:focus-within_[data-streamdown=code-block-actions]]:opacity-100 [&_[data-streamdown=code-block]:hover_[data-streamdown=code-block-actions]]:opacity-100 [&_div[data-streamdown=code-block-actions]]:border-0 [&_div[data-streamdown=code-block-actions]]:bg-transparent [&_div[data-streamdown=code-block-actions]]:p-0 [&_div[data-streamdown=code-block-actions]_button[data-streamdown=code-block-copy-button]]:rounded-control [&_div[data-streamdown=code-block-actions]_button[data-streamdown=code-block-copy-button]_svg]:size-3.5 [&_div[data-streamdown=code-block-actions]_button[data-streamdown=code-block-copy-button]:hover]:bg-hover-2 [&_[data-streamdown=unordered-list]]:list-outside [&_[data-streamdown=unordered-list]]:pl-5 [&_[data-streamdown=ordered-list]]:list-outside [&_[data-streamdown=ordered-list]]:pl-5 [&_[data-streamdown=code-block-header]_span:empty::after]:content-["txt"]';

/**
 * 聊天区 Markdown 统一入口：插件、控件、表格组件与文案只在此配置一次。
 * 默认 static；只有仍在流式输出的消息显式启用 streaming，完成态不能继续经过 remend 修补正文。
 */
export function ChatMarkdown({
  children,
  className,
  mode = 'static',
  ...props
}: ComponentProps<typeof Streamdown>) {
  return (
    <Streamdown
      className={cn(markdownStyles, className)}
      codeBlockMaxHeight={0}
      components={chatComponents}
      controls={chatControls}
      linkSafety={chatLinkSafety}
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
