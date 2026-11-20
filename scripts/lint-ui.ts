// 守住 src/ui 的组件约定（src/ui/README.md）：文件名、size 与 tone 取值、写法。
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const uiDir = join(root, 'src/ui');

type Rule = 'filename' | 'size' | 'tone' | 'style';

// 尚未对齐约定的组件。改好后必须从这里删除，新增的违规不允许加进来。
const pending: Record<string, Rule[]> = {
  'alert.tsx': ['filename', 'tone'],
  'button.tsx': ['size'],
  'desktop-only-notice.tsx': ['style'],
  'download-progress.tsx': ['style'],
  'file-icon.tsx': ['style'],
  'lightbox.tsx': ['filename', 'style'],
  'panel-header.tsx': ['size'],
  'panel-toggle.tsx': ['style'],
  'progress-ring.tsx': ['tone', 'style'],
  'resizable.tsx': ['style'],
  'segmented-control.tsx': ['style'],
  'shimmer.tsx': ['style'],
  'slider.tsx': ['style'],
  'status-pill.tsx': ['size', 'tone', 'style'],
  'stepper.tsx': ['style'],
  'switch.tsx': ['style'],
  'toast.tsx': ['filename', 'style'],
};

const sizes = new Set(['2xs', 'xs', 'sm', 'md', 'lg', 'xl']);
const tones = new Set(['accent', 'success', 'warning', 'danger', 'neutral']);
const isSize = (key: string) => sizes.has(key.replace(/^icon-/, ''));

function variantKeys(source: string, group: 'size' | 'tone'): string[] {
  const keys: string[] = [];
  for (const match of source.matchAll(new RegExp(`(?<![\\w-])${group}\\s*:\\s*\\{`, 'g'))) {
    let depth = 1;
    let index = match.index + match[0].length;
    while (depth > 0 && index < source.length) {
      const char = source[index];
      if (char === "'" || char === '"' || char === '`') {
        const start = index + 1;
        index = source.indexOf(char, start);
        if (depth === 1 && /^\s*:/.test(source.slice(index + 1)))
          keys.push(source.slice(start, index));
      } else if (char === '{' || char === '(' || char === '[') depth++;
      else if (char === '}' || char === ')' || char === ']') depth--;
      else if (depth === 1 && /[A-Za-z_$]/.test(char)) {
        const word = /^[\w$]+/.exec(source.slice(index))![0];
        if (/^\s*:/.test(source.slice(index + word.length))) keys.push(word);
        index += word.length - 1;
      }
      index++;
    }
  }
  return keys;
}

function exportedNames(source: string): string[] {
  const names = [
    ...source.matchAll(
      /export\s+(?:default\s+)?(?:async\s+)?(?:function|const|let|class|interface|type|enum)\s+(\w+)/g,
    ),
  ].map((match) => match[1]);
  for (const match of source.matchAll(/export\s*(?:type\s*)?\{([^}]*)\}/g))
    for (const item of match[1].split(',')) {
      const name = item
        .trim()
        .replace(/^type\s+/, '')
        .split(/\s+as\s+/)
        .pop();
      if (name) names.push(name);
    }
  return names;
}

function violations(file: string, source: string): { rule: Rule; message: string }[] {
  const found: { rule: Rule; message: string }[] = [];
  const expected = file
    .replace(/\.tsx$/, '')
    .split('-')
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join('');
  if (!exportedNames(source).includes(expected))
    found.push({
      rule: 'filename',
      message: `文件名对应的导出名应是 ${expected}，但文件没有导出它：让文件名与主导出名保持一致（dropdown-menu.tsx 导出 DropdownMenu）。`,
    });

  const badSizes = variantKeys(source, 'size').filter((key) => !isSize(key));
  if (badSizes.length > 0)
    found.push({
      rule: 'size',
      message: `size 取值 ${badSizes.join('、')} 不合规：只能用 2xs xs sm md lg xl 或 icon-<这些词>，默认值写 md，不用 default。`,
    });

  const badTones = [
    ...variantKeys(source, 'tone'),
    ...[...source.matchAll(/(?<![\w-])tone\??\s*:\s*((?:'[^']*'\s*\|?\s*)+)/g)].flatMap((match) =>
      [...match[1].matchAll(/'([^']*)'/g)].map((literal) => literal[1]),
    ),
  ].filter((key) => !tones.has(key));
  if (badTones.length > 0)
    found.push({
      rule: 'tone',
      message: `tone 取值 ${[...new Set(badTones)].join('、')} 不合规：只能用 accent success warning danger neutral，不用色相名。`,
    });

  const missing = [
    source.includes('data-slot') ? '' : '根元素缺少 data-slot',
    /export\s*\{[^}]*\}\s*;?\s*$/.test(source) ? '' : '文件末尾没有统一的 export { … }',
  ].filter(Boolean);
  if (missing.length > 0)
    found.push({ rule: 'style', message: `写法不合规：${missing.join('；')}。` });
  return found;
}

const files = readdirSync(uiDir, { withFileTypes: true })
  .filter(
    (entry) => entry.isFile() && /\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name),
  )
  .map((entry) => entry.name)
  .sort();

const errors: string[] = [];
for (const file of files) {
  const known = pending[file] ?? [];
  const found = violations(file, readFileSync(join(uiDir, file), 'utf8'));
  for (const { rule, message } of found)
    if (!known.includes(rule)) errors.push(`  src/ui/${file} [${rule}] ${message}`);
  for (const rule of known)
    if (!found.some((item) => item.rule === rule))
      errors.push(
        `  src/ui/${file} [${rule}] 已经符合约定：请从 scripts/lint-ui.ts 的 pending 清单里删除这一项。`,
      );
}
for (const file of Object.keys(pending))
  if (!files.includes(file))
    errors.push(`  src/ui/${file} 已不存在：请从 scripts/lint-ui.ts 的 pending 清单里删除。`);

if (errors.length > 0) {
  console.log(
    `src/ui 组件不符合约定（见 src/ui/README.md）${errors.length} 处：\n${errors.join('\n')}`,
  );
  process.exit(1);
}
