// 引用内联 token：文本即引用的唯一事实源。「@ + 已知相对路径」或「# + 会话标题」的连续文本是一个 token，
// 发送时解析回绝对路径或 sessionId；手打错误或已删除的只是普通文本，不高亮也不进上下文。
import type { ChatSessionSummary } from '../../../core/protocol/agent';
import type { WorkspaceEntry } from '../../workspace/contract';
import type { ChatReference } from './drafts';

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

/** 逐个去掉尾部标点直到命中已知 title：标题本身可能以标点结尾（「怎么复习？」）。 */
function knownTitle(value: string, titles: Map<string, ChatReference>): string {
  let end = value.length;
  while (end > 0 && !titles.has(value.slice(0, end)) && TRAILING_PUNCT.has(value[end - 1]!))
    end -= 1;
  return value.slice(0, end);
}

/** 扫描 text 中的全部引用 token（含重复）。@ 与 # 需位于行首或空白后，
 * user@host.com、C# 这类前置非空白的不参与；「# 」后紧跟空格是 Markdown 标题，也不参与。 */
export function matchReferenceTokens(text: string, options: ChatReference[]): ReferenceToken[] {
  const bySigil = { '@': new Map<string, ChatReference>(), '#': new Map<string, ChatReference>() };
  // 同名时先到先得：会话候选按最近更新排在前面。
  for (const ref of options) {
    const titles = bySigil[ref.session ? '#' : '@'];
    if (!titles.has(ref.title)) titles.set(ref.title, ref);
  }
  if (bySigil['@'].size + bySigil['#'].size === 0) return [];
  const tokens: ReferenceToken[] = [];
  const run = /(?:^|\s)([@#])([^\s]+)/g;
  for (const match of text.matchAll(run)) {
    const byTitle = bySigil[match[1] as '@' | '#'];
    const at = (match.index ?? 0) + match[0].length - match[2]!.length - 1;
    let segEnd = at + 1 + match[2]!.length;
    for (let extend = 0; ; extend += 1) {
      const candidate = knownTitle(text.slice(at + 1, segEnd), byTitle);
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

const pad = (value: number) => String(value).padStart(2, '0');

/** # 引用候选：同项目的其他会话，最近更新的在前；重名的缀上创建时间，文本仍能唯一对应一个会话。 */
export function sessionReferences(
  sessions: ChatSessionSummary[],
  currentId: string | null,
): ChatReference[] {
  const others = sessions
    .filter((session) => session.id !== currentId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const counts = new Map<string, number>();
  for (const { title } of others) counts.set(title, (counts.get(title) ?? 0) + 1);
  return others.map(({ id, title, createdAt }) => {
    const at = new Date(createdAt);
    const suffix = ` · ${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
    return { key: id, title: counts.get(title)! > 1 ? `${title}${suffix}` : title, session: true };
  });
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

/** 项目候选覆盖 cwd 下的全部文件；通用池再并入资料根目录，两者都排除项目目录，title 相对各自的根。
 *  title 冲突时先出现的保留。 */
export function referenceCandidates(
  entries: WorkspaceEntry[],
  cwd: string | null,
  projectId: string | null,
  workspaceRoot: string | null = null,
): ChatReference[] {
  if (!cwd) return [];
  const general = projectId === null;
  const foreign = general
    ? entries.filter((entry) => entry.kind === 'project' && entry.path).map((entry) => entry.path!)
    : [];
  const roots = general && workspaceRoot ? [cwd, workspaceRoot] : [cwd];
  const seen = new Set<string>();
  const refs: ChatReference[] = [];
  for (const root of roots) {
    for (const entry of entries) {
      const path = entry.path;
      if (!path || entry.kind === 'folder' || entry.kind === 'project') continue;
      const title = relativeTo(path, root);
      if (title === null || seen.has(title)) continue;
      if (foreign.some((project) => relativeTo(path, project) !== null)) continue;
      seen.add(title);
      refs.push({ key: path, title });
    }
  }
  return refs;
}

/** 通用池会话在 cwd 与资料根目录之外并入已下载课件候选：课件文件不在 workspace 镜像里。
 *  title 冲突时工作区文件优先。 */
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

/** 远端会话用远端索引候选（文件不在本地镜像里）；本机项目只用自己的目录候选；
 *  通用池另并入资料根目录与已下载课件。 */
export function referenceEntryCandidates(
  entries: WorkspaceEntry[],
  cwd: string | null,
  projectId: string | null,
  remote: string | null | undefined,
  remoteEntries: ChatReference[],
  courseFiles: { path: string; title: string }[],
  workspaceRoot: string | null = null,
): ChatReference[] {
  if (remote) return remoteEntries;
  const local = referenceCandidates(entries, cwd, projectId, workspaceRoot);
  if (projectId !== null) return local;
  return withCourseReferences(local, courseFiles);
}
