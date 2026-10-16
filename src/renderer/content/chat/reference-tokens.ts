// @ 引用内联 token：文本即引用的唯一事实源。composer 里「@ + 已知相对路径（title）」
// 的连续文本是一个引用 token——编辑器按这里的规则高亮，发送时解析回绝对路径（key）。
// 手打错误、已删除文件的 @路径不高亮也不进上下文，只是普通文本。
import type { WorkspaceEntry } from '../../../shared/api';
import type { ChatReference } from './drafts';

/** 文本中的一个引用 token：[start, end) 覆盖「@路径」全段（含 @，不含尾部标点）。 */
export interface ReferenceToken {
  start: number;
  end: number;
  ref: ChatReference;
}

// token 尾部这些标点视为句子成分而非路径的一部分（如「@a.md。」末尾的句号）。
const TRAILING_PUNCT = new Set([
  '.',
  ',',
  ';',
  ':',
  '!',
  '?',
  ')',
  ']',
  '}',
  '"',
  "'",
  '`',
  '、',
  '，',
  '。',
  '；',
  '：',
  '！',
  '？',
  '）',
  '】',
  '》',
  '」',
  '’',
  '”',
]);

// title 可含空格（文件名带空格合法）：run 未命中时向后按空白段扩展再试，最多 8 段。
const MAX_SPACE_EXTENSIONS = 8;

function trimTrailingPunct(value: string): string {
  let end = value.length;
  while (end > 0 && TRAILING_PUNCT.has(value[end - 1]!)) end -= 1;
  return value.slice(0, end);
}

/** 扫描 text 中的全部引用 token（含重复）。@ 需位于行首或空白后，
 * user@host.com 这类前置非空白的 @ 不参与。 */
export function matchReferenceTokens(text: string, options: ChatReference[]): ReferenceToken[] {
  const byTitle = new Map(options.map((ref) => [ref.title, ref]));
  if (byTitle.size === 0) return [];
  const tokens: ReferenceToken[] = [];
  // @ 前必须是行首或空白：候选 run 到首个空白为止，之后按需跨空格扩展。
  const run = /(?:^|\s)@([^\s]+)/g;
  for (const match of text.matchAll(run)) {
    const at = (match.index ?? 0) + match[0].length - match[1]!.length - 1;
    let segEnd = at + 1 + match[1]!.length;
    for (let extend = 0; ; extend += 1) {
      const candidate = trimTrailingPunct(text.slice(at + 1, segEnd));
      const ref = byTitle.get(candidate);
      if (ref) {
        tokens.push({ start: at, end: at + 1 + candidate.length, ref });
        break;
      }
      if (extend === MAX_SPACE_EXTENSIONS) break;
      const space = text.indexOf(' ', segEnd);
      if (space < 0) break;
      const nextBlank = /\s/.exec(text.slice(space + 1));
      segEnd = nextBlank ? space + 1 + nextBlank.index : text.length;
    }
  }
  return tokens;
}

/** 发送用：解析出的引用按 key 去重（同文件 @ 两次只进一次上下文），保持出现顺序。 */
export function referenceContext(text: string, options: ChatReference[]): ChatReference[] {
  const seen = new Set<string>();
  const refs: ChatReference[] = [];
  for (const token of matchReferenceTokens(text, options)) {
    if (seen.has(token.ref.key)) continue;
    seen.add(token.ref.key);
    refs.push(token.ref);
  }
  return refs;
}

/** path 在 base 之下时返回相对路径；仅 Windows 路径归一化分隔符与大小写。 */
function relativeTo(path: string, base: string): string | null {
  const windows = /^(?:[a-z]:[\\/]|\\\\)/i.test(base);
  const target = windows ? path.replaceAll('\\', '/') : path;
  const root = (windows ? base.replaceAll('\\', '/') : base).replace(/\/+$/, '') + '/';
  const matches = windows
    ? target.toLowerCase().startsWith(root.toLowerCase())
    : target.startsWith(root);
  return matches && target.length > root.length ? target.slice(root.length) : null;
}

/** @ 候选：会话 cwd 之下、且不属于其他项目目录的文件，title 为相对 cwd 的路径。
 *  通用池的 cwd 是工作区根，而各项目目录就挂在工作区根下面——只按 cwd 过滤的话，
 *  随聊的 @ 会列出别的项目的文件：上一个会话在哪个项目，看上去就像串了哪个会话的上下文。 */
export function referenceCandidates(
  entries: WorkspaceEntry[],
  cwd: string | null,
  projectId: string | null,
): ChatReference[] {
  if (!cwd) return [];
  const foreign = entries
    .filter((entry) => entry.kind === 'project' && entry.id !== projectId && entry.path)
    .map((entry) => entry.path!);
  const refs: ChatReference[] = [];
  for (const entry of entries) {
    const path = entry.path;
    if (!path || entry.kind === 'folder' || entry.kind === 'project') continue;
    const title = relativeTo(path, cwd);
    if (title === null) continue;
    if (foreign.some((root) => relativeTo(path, root) !== null)) continue;
    refs.push({ key: path, title });
  }
  return refs;
}

/** 通用池会话（随聊/资料页）的 cwd 之外并入已下载课件候选：cwd 是随聊私有目录或课件根目录
 *  本身，课件文件不在 workspace 镜像里，按 cwd 过滤永远为空。title 冲突时工作区文件优先。 */
export function withCourseReferences(
  local: ChatReference[],
  courseFiles: { path: string; title: string }[],
): ChatReference[] {
  const seen = new Set(local.map((ref) => ref.title));
  const merged = [...local];
  for (const file of courseFiles) {
    if (seen.has(file.title)) continue;
    seen.add(file.title);
    merged.push({ key: file.path, title: file.title });
  }
  return merged;
}

/** useEntries 的分支逻辑（WorkbenchShell 调用）：远端会话用远端索引候选（其文件不在本地
 *  镜像里，referenceCandidates 恒为空）；本机项目会话只用自己的目录候选；通用池
 *  （projectId 为 null）另并入已下载课件。 */
export function referenceEntryCandidates(
  entries: WorkspaceEntry[],
  cwd: string | null,
  projectId: string | null,
  remote: string | null | undefined,
  remoteEntries: ChatReference[],
  courseFiles: { path: string; title: string }[],
): ChatReference[] {
  if (remote) return remoteEntries;
  const local = referenceCandidates(entries, cwd, projectId);
  if (projectId !== null) return local;
  return withCourseReferences(local, courseFiles);
}
