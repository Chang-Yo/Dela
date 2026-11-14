// 守住 ADR 0018 冻结的 token：禁用 token 体系之外的写法，并找出写了却不生成 CSS 的类名。
import { createRequire } from 'node:module';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

const alias =
  'background|foreground|card(?:-foreground)?|popover(?:-foreground)?|primary(?:-foreground)?|secondary(?:-foreground)?|muted(?:-foreground)?|accent-foreground|destructive(?:-foreground)?|border|input|ring|sidebar(?:-foreground|-primary(?:-foreground)?|-accent(?:-foreground)?|-border|-ring)?';
const palette =
  'black|white|(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\\d{2,3}';
const prefix = '(?<![\\w-])(?:[\\w-]+:|\\[[^\\]]+\\]:)*';

const rules: Record<string, RegExp> = {
  alias: new RegExp(
    `${prefix}(?:bg|text|border(?:-[trblxy])?|ring|outline|fill|stroke|divide|from|to|via|placeholder|caret|decoration)-(?:${alias})(?:/\\d+)?(?![\\w-])`,
    'g',
  ),
  'alias-var': new RegExp(`var\\(--(?:${alias}|radius|color-[\\w-]+)\\)`, 'g'),
  radius: new RegExp(
    `${prefix}rounded(?:-(?:[trblse]|tl|tr|bl|br|ss|se|es|ee))?-(?:sm|md|lg|xl|2xl|3xl)(?![\\w-])`,
    'g',
  ),
  palette: new RegExp(`${prefix}[a-z]+-(?:${palette})(?:/\\d+)?(?![\\w-])`, 'g'),
  duration: new RegExp(`${prefix}duration-[1-9]\\d*(?![\\w-])`, 'g'),
  'z-global': new RegExp(`${prefix}-?z-(?:[3-9]\\d|\\d{3,}|\\[[^\\]]+\\])(?![\\w-])`, 'g'),
  'font-size': new RegExp(`${prefix}text-(?:9|10|2xs|13|15|21|\\[\\d+px\\])(?![\\w-])`, 'g'),
  arbitrary: new RegExp(
    `${prefix}(?:shadow|bg|text|border|ring|fill|stroke|outline)-\\[(?:#|var\\(|rgba?\\(|oklch\\(|0_|inset_|\\d+px\\])[^\\]\\s]*\\]?|${prefix}animate-\\[[^\\]\\s]+\\]`,
    'g',
  ),
};
// token 定义本身，以及给 streamdown 的 shadcn 兼容名。
const tokenFiles = new Set(['src/ui/tokens.css', 'src/renderer/styles/globals.css']);

function* sourceFiles(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* sourceFiles(path);
    else if (/\.(tsx?|css)$/.test(name) && !/\.test\.tsx?$/.test(name)) yield path;
  }
}

const forbidden: string[] = [];
for (const path of sourceFiles(join(root, 'src'))) {
  const file = relative(root, path).replaceAll('\\', '/');
  if (tokenFiles.has(file)) continue;
  readFileSync(path, 'utf8')
    .split('\n')
    .forEach((line, index) => {
      for (const [name, pattern] of Object.entries(rules))
        for (const match of line.matchAll(pattern))
          forbidden.push(`  [${name}] ${file}:${index + 1}  ${match[0]}`);
    });
}

const viteRequire = createRequire(
  createRequire(`${root}/package.json`).resolve('@tailwindcss/vite'),
);
const { compile } = viteRequire('@tailwindcss/node') as typeof import('@tailwindcss/node');
const { Scanner } = viteRequire('@tailwindcss/oxide') as typeof import('@tailwindcss/oxide');

const entry = resolve(root, 'src/renderer/styles/globals.css');
const compiler = await compile(readFileSync(entry, 'utf8'), {
  base: dirname(entry),
  onDependency: () => {},
});
const candidates = new Scanner({
  sources: [
    { base: resolve(root, 'src/renderer'), pattern: '**/*', negated: false },
    ...compiler.sources,
  ],
}).scan();

// 只查引用 token 的工具类族；扫描器会把内联样式里的 CSS 属性名也当成候选。
const families =
  /^(?:[\w-]+:)*-?(?:text|bg|border(?:-[trblxy])?|rounded(?:-[trbl]{1,2})?|shadow|ring|outline|fill|stroke|from|via|to|divide|decoration|caret|accent|placeholder|z|duration|ease|animate|font|leading)-/;
const cssProperties = new Set([
  'border-left',
  'border-radius',
  'border-top',
  'font-family',
  'font-size',
  'font-src',
  'font-synthesis',
  'font-weight',
  'stroke-dashoffset',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-width',
  'text-align',
  'text-decoration',
  'text-underline-offset',
]);
const checked = candidates
  .filter((candidate) => families.test(candidate) && !cssProperties.has(candidate))
  .sort();

let size = compiler.build([]).length;
const unknown: string[] = [];
for (const candidate of checked) {
  const next = compiler.build([candidate]).length;
  if (next === size) unknown.push(`  ${candidate}`);
  size = next;
}

if (forbidden.length > 0)
  console.log(`token 体系之外的写法 ${forbidden.length} 处：\n${forbidden.join('\n')}`);
if (unknown.length > 0)
  console.log(`不生成 CSS 的类名 ${unknown.length} 个：\n${unknown.join('\n')}`);
if (forbidden.length + unknown.length > 0) process.exit(1);
