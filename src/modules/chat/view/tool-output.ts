import { z } from 'zod';

// 工具输出的解析：Pi 内置工具把提示拼在文本尾部，web_search 返回 JSON；格式见各函数注释。

const lines = (text: string) => text.split('\n');

/** 行数：结尾的换行不另算一行，空文本为 0。 */
export function lineCount(text: string) {
  return text ? lines(text).length - (text.endsWith('\n') ? 1 : 0) : 0;
}

/** edit 的增删行数：每组前后文本先去掉首尾相同的行，只数真正变动的行。 */
export function editLineCounts(edits: { oldText?: string; newText?: string }[]) {
  const total = { added: 0, deleted: 0 };
  for (const { oldText = '', newText = '' } of edits) {
    const before = oldText ? lines(oldText) : [];
    const after = newText ? lines(newText) : [];
    let head = 0;
    while (head < before.length && head < after.length && before[head] === after[head]) head++;
    let tail = 0;
    while (
      tail < before.length - head &&
      tail < after.length - head &&
      before.at(-1 - tail) === after.at(-1 - tail)
    )
      tail++;
    total.deleted += before.length - head - tail;
    total.added += after.length - head - tail;
  }
  return total;
}

const readNotice =
  /\n\n\[(?:Showing lines (\d+)-(\d+) of (\d+)[^\]]*|(\d+) more lines in file\.[^\]]*)\]$/;

/** 拆出 read 的正文与行范围：Pi 截断时在尾部追加 `[Showing lines X-Y of Z ...]` 或 `[N more lines ...]`。 */
export function parseReadOutput(text: string, offset = 1) {
  const notice = readNotice.exec(text);
  const body = notice ? text.slice(0, notice.index) : text;
  const shown = lineCount(body);
  if (!notice) return { body, shown };
  if (notice[1])
    return { body, shown, range: { from: +notice[1], to: +notice[2]!, total: +notice[3]! } };
  const to = offset + shown - 1;
  return { body, shown, range: { from: offset, to, total: to + +notice[4]! } };
}

const listingNotice = /\n\n\[[^\]]*\]$/;
const emptyListings = new Set([
  'No matches found',
  'No files found matching pattern',
  '(empty directory)',
]);

/** grep / find / ls 的结果行数：去掉尾部提示，「无结果」类提示不算行。 */
export function listingCount(text: string) {
  const body = text.replace(listingNotice, '');
  return emptyListings.has(body.trim()) ? 0 : lines(body).filter((line) => line.trim()).length;
}

/** bash 失败时 Pi 在输出尾部写 `Command exited with code N`；超时、中止没有退出码。 */
export function bashExitCode(text: string) {
  const code = /Command exited with code (\d+)\s*$/.exec(text)?.[1];
  return code === undefined ? undefined : Number(code);
}

const webSearchSchema = z.object({
  query: z.string(),
  results: z.array(z.object({ url: z.string(), title: z.string(), snippet: z.string() })),
});

/** web_search 的输出是 JSON 文本；不符合约定返回 null，由调用方退回通用视图。只留 http(s) 链接。 */
export function parseWebSearch(text: string) {
  try {
    const parsed = webSearchSchema.safeParse(JSON.parse(text));
    if (!parsed.success) return null;
    const results = parsed.data.results.filter(({ url }) => /^https?:\/\//i.test(url));
    return { ...parsed.data, results };
  } catch {
    return null;
  }
}

export function prettyJson(text: string) {
  if (!/^\s*[{[]/.test(text)) return null;
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return null;
  }
}

export function hostnameOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
