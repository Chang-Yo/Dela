// 注释最先腐烂的是它指向的东西：文件改名、删除后，注释里的路径和已删的决策编号还在误导读者。
import { parseSync } from '@babel/core';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, posix, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
  .split('\n')
  .filter(Boolean);
const trackedSet = new Set(tracked);
const sources = tracked.filter((file) => /^(src|scripts)\/.*\.(tsx?|cjs)$/.test(file));

const adrReference = /\bADR\b|\bAD-\d+|（00\d\d）/;
const fileReference = /[\w@.\-/]*\w\.(?:tsx?|cjs|go|css)\b/g;

function exists(file: string, reference: string) {
  if (reference.startsWith('.')) return trackedSet.has(posix.join(dirname(file), reference));
  return tracked.some((path) => path === reference || path.endsWith(`/${reference}`));
}

const problems: string[] = [];
for (const file of sources) {
  const ast = parseSync(readFileSync(resolve(root, file), 'utf8'), {
    babelrc: false,
    configFile: false,
    filename: file,
    parserOpts: { plugins: file.endsWith('.ts') ? ['typescript'] : ['typescript', 'jsx'] },
  });
  for (const comment of ast?.comments ?? []) {
    const at = `${file}:${comment.loc?.start.line}`;
    if (adrReference.test(comment.value)) problems.push(`${at} 引用了已删除的 ADR`);
    for (const [reference] of comment.value.matchAll(fileReference))
      if (!exists(file, reference)) problems.push(`${at} 指向不存在的文件 ${reference}`);
  }
}

if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
