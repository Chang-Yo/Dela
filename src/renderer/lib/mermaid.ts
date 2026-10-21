// mermaid 的共享配置与按需渲染：聊天区（streamdown 插件）与笔记即时渲染共用同一套主题和字体。
// mermaid 本体体积大，只在首次渲染图表时才动态加载。
import type { MermaidConfig } from '@streamdown/mermaid';

// mermaid 渲染的 svg 文本默认用 trebuchet ms 等字体，与界面割裂；这里显式给定与应用一致的
// sans 栈（与 globals.css 的 --font-sans 手工同步，那边改动需带这边）。
const MERMAID_FONT_FAMILY = "Inter, 'Segoe UI Variable', 'Microsoft YaHei UI', sans-serif";

let cached: { dark: boolean; config: MermaidConfig } | null = null;

/** mermaid 只在初始化时读主题：按当前明暗缓存，主题切换时引用变化即可触发重绘。 */
export function mermaidConfig(): MermaidConfig {
  const dark = document.documentElement.classList.contains('dark');
  if (!cached || cached.dark !== dark)
    cached = {
      dark,
      config: { theme: dark ? 'dark' : 'default', fontFamily: MERMAID_FONT_FAMILY },
    };
  return cached.config;
}

/** 渲染一张图，返回 svg 文本；语法错误时抛出 mermaid 的报错。 */
export async function renderMermaid(id: string, chart: string, config?: MermaidConfig) {
  const { mermaid } = await import('@streamdown/mermaid');
  return mermaid.getMermaid(config ?? mermaidConfig()).render(id, chart);
}
