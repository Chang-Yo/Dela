// 从两份清单里去掉交大模块，供 CI 验证“没有交大也能构建和启动”；只在 CI 的临时副本里运行。
import { readFileSync, writeFileSync } from 'node:fs';

const manifests = ['src/app/modules.ts', 'src/app/views.ts'];
const sjtuImport = /^import \{ (\w+) \} from '\.\.\/sjtu\/.*';\s*$/;

for (const file of manifests) {
  const lines = readFileSync(file, 'utf8').split('\n');
  const names = lines.flatMap((line) => sjtuImport.exec(line)?.[1] ?? []);
  if (names.length === 0) throw new Error(`${file} 里没有找到交大模块`);
  const kept = lines.filter(
    (line) => !sjtuImport.test(line) && !names.includes(line.trim().replace(/,$/, '')),
  );
  if (lines.length - kept.length !== names.length * 2)
    throw new Error(`${file}：交大模块的引用不是“一行 import、一行清单”的形式`);
  writeFileSync(file, kept.join('\n'));
  console.log(`${file}: 去掉 ${names.join('、')}`);
}
