// 守住 ADR 0025：只有表的主人写自己表的 SQL，别人经主人 index.ts 导出的函数读写。
// workspace_settings 是宿主的共享键值表，谁都能用，但同一个键只能归一方。
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const shared = new Set(['workspace_settings']);

function ownerOf(file: string): string {
  const [area, name] = relative(join(root, 'src'), file).split(sep);
  return area === 'modules' || area === 'sjtu' ? name! : area!;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((item) => {
    const path = join(dir, item.name);
    if (item.isDirectory()) return item.name === 'test' ? [] : sourceFiles(path);
    return /\.tsx?$/.test(item.name) && !/\.test\.tsx?$/.test(item.name) ? [path] : [];
  });
}

/** 源码里的字符串与模板字面量；跳过注释和正则字面量，免得其中的引号打乱配对。 */
function* literals(source: string): Generator<{ text: string; index: number }> {
  let last = '';
  for (let i = 0; i < source.length; i++) {
    const char = source[i]!;
    if (/\s/.test(char)) continue;
    if (source.startsWith('//', i)) i = source.indexOf('\n', i) >>> 0 || source.length;
    else if (source.startsWith('/*', i)) i = source.indexOf('*/', i + 2) + 1;
    else if (
      char === '/' &&
      (/[(,=:[!&|?{};+\-*%<>~^]/.test(last) ||
        /\b(return|typeof|case|in|of)$/.test(source.slice(Math.max(0, i - 7), i).trimEnd()) ||
        last === '')
    ) {
      let inClass = false;
      for (i++; i < source.length && (source[i] !== '/' || inClass); i++) {
        if (source[i] === '\\') i++;
        else if (source[i] === '[') inClass = true;
        else if (source[i] === ']') inClass = false;
      }
      last = '/';
    } else if (char === "'" || char === '"' || char === '`') {
      const start = i;
      for (i++; i < source.length && source[i] !== char; i++) if (source[i] === '\\') i++;
      yield { text: source.slice(start + 1, i), index: start };
      last = char;
    } else last = char;
  }
}

const files = sourceFiles(join(root, 'src'));
const isSchema = (file: string) =>
  file.endsWith(`${sep}data${sep}schema.ts`) || file.includes(`${sep}main${sep}migrations${sep}`);

const tableOwners = new Map<string, string>();
for (const file of [...files.filter(isSchema), join(root, 'src/app/main/database.ts')])
  for (const match of readFileSync(file, 'utf8').matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g))
    if (!file.includes(`${sep}migrations${sep}`)) tableOwners.set(match[1]!, ownerOf(file));

const found: string[] = [];
const settingKeys = new Map<string, Set<string>>();
const addSettingKey = (key: string, owner: string) =>
  settingKeys.set(key, (settingKeys.get(key) ?? new Set()).add(owner));
for (const file of files.filter((file) => !isSchema(file))) {
  const owner = ownerOf(file);
  const source = readFileSync(file, 'utf8');
  const usesSettings = /workspace_settings|\b(read|write)Setting\(/.test(source);
  for (const literal of literals(source)) {
    const text = literal.text;
    if (usesSettings) {
      const before = source.slice(Math.max(0, literal.index - 40), literal.index);
      const head = text.split('${')[0]!;
      if (/workspace_settings/.test(text))
        for (const match of text.matchAll(/\bkey\s*=\s*'([^']+)'|VALUES\s*\(\s*'([^']+)'/g))
          addSettingKey(match[1] ?? match[2]!, owner);
      else if (
        /^[a-z][a-z0-9-]*(:|$)/.test(head) &&
        (/(Setting\(|key\s*=)\s*$/i.test(before) ||
          (text.includes('${') && /(=>|return|\.run\(|\.get\()\s*$/.test(before)))
      )
        addSettingKey(head, owner);
    }
    if (!/\b(SELECT|INSERT|UPDATE|DELETE)\b/.test(text)) continue;
    for (const match of text.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+(\w+)/g)) {
      const table = match[1]!;
      const tableOwner = tableOwners.get(table);
      if (!tableOwner || tableOwner === owner || shared.has(table)) continue;
      const line = source.slice(0, literal.index).split('\n').length;
      found.push(`${relative(root, file)}:${line}  ${owner} → ${table}（${tableOwner}）`);
    }
  }
}

if (found.length) {
  console.error(`有 ${found.length} 处 SQL 直接读写别人的表，请改用表主人 index.ts 导出的函数：`);
  for (const item of [...new Set(found)]) console.error(`  ${item}`);
  process.exit(1);
}

const clashes = [...settingKeys].filter(([, owners]) => owners.size > 1);
if (clashes.length) {
  console.error('workspace_settings 的同一个键被多方使用，请改名或改经主人 index.ts 读写：');
  for (const [key, owners] of clashes) console.error(`  ${key}  ${[...owners].join('、')}`);
  process.exit(1);
}
