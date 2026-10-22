// mermaid 的共享配置与按需渲染：聊天区（streamdown 插件）与笔记即时渲染共用同一套主题和字体。
// mermaid 本体体积大，只在首次渲染图表时才动态加载。
import type { MermaidConfig } from '@streamdown/mermaid';

// mermaid 渲染的 svg 文本默认用 trebuchet ms 等字体，与界面割裂；字体栈取自界面自身
// （globals.css 的 --font-sans），不再手工同步一份副本。
function interfaceFontFamily(): string {
  return getComputedStyle(document.documentElement).fontFamily;
}

let cached: { dark: boolean; config: MermaidConfig } | null = null;

/** mermaid 只在初始化时读主题：按当前明暗缓存，主题切换时引用变化即可触发重绘。 */
export function mermaidConfig(): MermaidConfig {
  const dark = document.documentElement.classList.contains('dark');
  if (!cached || cached.dark !== dark)
    cached = {
      dark,
      config: { theme: dark ? 'dark' : 'default', fontFamily: interfaceFontFamily() },
    };
  return cached.config;
}

/** 渲染一张图，返回 svg 文本；语法错误时抛出 mermaid 的报错。 */
export async function renderMermaid(id: string, chart: string, config?: MermaidConfig) {
  const { mermaid } = await import('@streamdown/mermaid');
  return mermaid.getMermaid(config ?? mermaidConfig()).render(id, chart);
}
