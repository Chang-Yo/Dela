import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const tracked = execFileSync('git', ['ls-files', 'src'], { encoding: 'utf8' })
  .split('\n')
  .filter((file) => /\.tsx?$/.test(file) && !file.includes('/beautifului/'));
const isTest = (file: string) => /(^|\/)test\/|\.test\.tsx?$/.test(file);
const source = tracked.filter((file) => !isTest(file));
const tests = tracked.filter(isTest);
const renderer = source.filter((file) =>
  /^src\/(renderer|ui|modules\/[^/]+\/view|sjtu\/[^/]+\/view)\//.test(file),
);
const read = (file: string) => readFileSync(file, 'utf8');
const count = (files: string[], pattern: RegExp) =>
  files.reduce((sum, file) => sum + (read(file).match(pattern)?.length ?? 0), 0);
const lines = (files: string[]) =>
  files.reduce((sum, file) => sum + read(file).split('\n').length, 0);
const commentLines = (files: string[]) =>
  files.reduce(
    (sum, file) =>
      sum +
      read(file)
        .split('\n')
        .filter((line) => /^\s*(\/\/|\/\*|\*)/.test(line)).length,
    0,
  );

const metrics = {
  'renderer useEffect/useLayoutEffect': count(renderer, /\buse(Layout)?Effect\(/g),
  'renderer useRef': count(renderer, /\buseRef\b(<[^>]*>)?\(/g),
  'renderer useMemo': count(renderer, /\buseMemo\(/g),
  'renderer useCallback': count(renderer, /\buseCallback\(/g),
  'renderer setTimeout': count(renderer, /\bsetTimeout\(/g),
  'zustand stores': count(
    source,
    /\bcreate(<[^>]*>)?\(\s*(\)\s*\(\s*)?(\(set|persist|subscribeWithSelector)/g,
  ),
  'source lines': lines(source),
  'comment lines': commentLines(source),
  'test files': tests.length,
  'test lines': lines(tests),
};

console.table(metrics);
