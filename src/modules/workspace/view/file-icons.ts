// 逐扩展名文件图标：映射直接消费 devDependency material-icon-theme 的上游 manifest
// （fileExtensions + fileNames），仓库不留生成物，升级依赖即生效。SVG 资产 dev 经
// /@fs/ 读 node_modules，构建时由 vite.renderer.config.ts 拷入 out/renderer/file-icons/。
// 查不到返回 null，调用方回落到通用文档图标。
import manifest from 'material-icon-theme/dist/material-icons.json';

declare const __FILE_ICONS_DIR__: string;

// 映射值指向 iconDefinitions 的键，真正的资产是 icons/ 下的 SVG 文件名，经此解一层引用。
const svgOfDefinition = new Map<string, string>();
for (const [definition, meta] of Object.entries(manifest.iconDefinitions)) {
  const svg = meta.iconPath?.split('/').pop();
  if (svg) svgOfDefinition.set(definition, svg);
}

// 上游有少量混合大小写的键（fileNames 21 个、fileExtensions 2 个），查询前统一小写。
function resolveKeys(mapping: Record<string, string>): Map<string, string> {
  const resolved = new Map<string, string>();
  for (const [key, definition] of Object.entries(mapping)) {
    const svg = svgOfDefinition.get(definition);
    if (svg) resolved.set(key.toLowerCase(), svg);
  }
  return resolved;
}

const byName = resolveKeys(manifest.fileNames);
const byExt = resolveKeys(manifest.fileExtensions);
const baseUrl = import.meta.env.DEV ? `/@fs/${__FILE_ICONS_DIR__}/` : './file-icons/';

export function fileIconUrl(fileName: string): string | null {
  const name = fileName.toLowerCase();
  const icon = byName.get(name) ?? suffixIconOf(name);
  return icon ? baseUrl + icon : null;
}

// 后缀从长到短：「vue.config.js」优先于「js」；点文件（.gitignore）由 byName 命中。
function suffixIconOf(name: string): string | null {
  let dot = name.indexOf('.');
  while (dot !== -1) {
    const icon = byExt.get(name.slice(dot + 1));
    if (icon) return icon;
    dot = name.indexOf('.', dot + 1);
  }
  return null;
}
