// 轮次审阅记录工作目录的前后状态，不依赖工具名称，也不把历史 diff 重新对当前文件计算。
import { app } from 'electron';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { gzip, gunzip } from 'node:zlib';
import { createTwoFilesPatch } from 'diff';
import { diffStatOf } from '../../shared/diff';
import type {
  FileChangeDetail,
  FileChangeSummary,
  TurnChanges,
  UncommittedChanges,
} from '../../shared/chat';

const execute = promisify(execFile);
const compress = promisify(gzip);
const decompress = promisify(gunzip);
// 覆盖普通项目，限制单轮内存与主进程工作量；超限必须在接口中标记，不截断后假装完整。
const FILE_LIMIT = 10_000;
const HASH_BYTE_LIMIT = 16 * 1024 * 1024;
const TEXT_BYTE_LIMIT = 1024 * 1024;
const TEXT_BUDGET = 16 * 1024 * 1024;
const excluded = new Set([
  '.git',
  'node_modules',
  '.venv',
  'venv',
  '__pycache__',
  '.cache',
  '.next',
  '.nuxt',
  '.tools',
  '.build',
  'dist',
  'out',
  'target',
  'coverage',
]);

interface FileState {
  bytes: number;
  fingerprint: string;
  mode: number;
  text: string | null;
  note: string | null;
}

export interface DirectorySnapshot {
  files: Record<string, FileState>;
  /** 无法读取的路径不能被误判为删除。 */
  unreadable: string[];
  warnings: string[];
}

interface SavedChange {
  path: string;
  before: FileState | null;
  after: FileState | null;
}

interface SavedTurn extends Omit<TurnChanges, 'files'> {
  files: SavedChange[];
}

const slash = (path: string) => path.replaceAll('\\', '/');
const included = (path: string) => !path.split('/').some((part) => excluded.has(part));
const inside = (root: string, path: string) => {
  const part = relative(root, path);
  return (
    part !== '..' &&
    !part.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) &&
    !isAbsolute(part)
  );
};
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

async function command(cwd: string, executable: string, args: string[]) {
  return (
    await execute(executable, args, {
      cwd,
      encoding: 'buffer',
      timeout: 15_000,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
      env: { ...process.env, LC_ALL: 'C', GIT_OPTIONAL_LOCKS: '0' },
    })
  ).stdout;
}

async function repository(cwd: string): Promise<{ root: string | null; missing: boolean }> {
  await realpath(cwd);
  try {
    return {
      root: (await command(cwd, 'git', ['rev-parse', '--show-toplevel'])).toString('utf8').trim(),
      missing: false,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { root: null, missing: true };
    // 只将 Git 明确报告的非仓库视为隐藏入口，权限等错误继续上报。
    if (String((error as { stderr?: Buffer }).stderr).includes('not a git repository'))
      return { root: null, missing: false };
    throw error;
  }
}

async function pathsIn(cwd: string): Promise<string[]> {
  const repo = await repository(cwd);
  if (repo.root)
    return (
      await command(cwd, 'git', [
        'ls-files',
        '-z',
        '--cached',
        '--others',
        '--exclude-standard',
        '--',
        '.',
      ])
    )
      .toString('utf8')
      .split('\0')
      .filter(Boolean);
  try {
    const args = ['--files', '--hidden', '--no-require-git', '-0'];
    for (const name of excluded) args.push('-g', `!${name}`);
    return (await command(cwd, 'rg', [...args, '--', '.']))
      .toString('utf8')
      .split('\0')
      .filter(Boolean);
  } catch (error) {
    if ((error as { code?: number }).code === 1 && !(error as { stderr?: Buffer }).stderr?.length)
      return [];
    throw error;
  }
}

function stateOf(bytes: Buffer, budget: { remaining: number }): FileState {
  const state: FileState = {
    bytes: bytes.length,
    fingerprint: createHash('sha256').update(bytes).digest('hex'),
    mode: 0,
    text: null,
    note: null,
  };
  if (bytes.length > TEXT_BYTE_LIMIT) state.note = '文件超过 1 MiB，只提供变更标记';
  else {
    try {
      if (bytes.includes(0)) throw new Error('binary');
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (budget.remaining < bytes.length) state.note = '本次文本快照超过 16 MiB 预算';
      else {
        state.text = text;
        budget.remaining -= bytes.length;
      }
    } catch {
      state.note = '二进制或非 UTF-8 文件，不提供文本 diff';
    }
  }
  return state;
}

async function diskState(
  cwd: string,
  path: string,
  budget: { remaining: number },
): Promise<FileState | null> {
  const target = resolve(cwd, path);
  if (!inside(cwd, target)) throw new Error('路径超出工作目录');
  try {
    const info = await lstat(target);
    if (info.isSymbolicLink() || !inside(cwd, await realpath(target)))
      throw new Error('非普通文件或符号链接，不记录内容');
    if (!info.isFile()) return null;
    if (info.size > HASH_BYTE_LIMIT)
      return {
        bytes: info.size,
        mode: info.mode & 0o777,
        fingerprint: `metadata:${info.size}:${info.mtimeMs}`,
        text: null,
        note: '文件超过 16 MiB，仅按大小与修改时间判断变化',
      };
    const state = stateOf(await readFile(target), budget);
    state.mode = info.mode & 0o777;
    return state;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function captureDirectory(
  cwd: string,
  previousPaths: string[] = [],
): Promise<DirectorySnapshot> {
  cwd = await realpath(cwd);
  const files: Record<string, FileState> = Object.create(null);
  const unreadable: string[] = [];
  const warnings = new Set<string>();
  const budget = { remaining: TEXT_BUDGET };
  const paths = [
    ...new Set(
      [...(await pathsIn(cwd)), ...previousPaths].map((path) =>
        slash(relative(cwd, resolve(cwd, path))),
      ),
    ),
  ]
    .filter(included)
    .sort();
  if (paths.length > FILE_LIMIT) warnings.add('工作目录超过 10,000 个文件，本轮记录不完整');
  for (const path of paths.slice(0, FILE_LIMIT)) {
    // 快照本身不应进入被跟踪目录，即使用户将 cwd 指向了应用数据目录。
    if (inside(changesRoot(), resolve(cwd, path))) continue;
    try {
      const state = await diskState(cwd, path, budget);
      if (state) {
        files[path] = state;
        if (state.note) warnings.add(state.note);
      }
    } catch (error) {
      unreadable.push(path);
      warnings.add(`${path}: ${errorText(error)}`);
    }
  }
  unreadable.push(...paths.slice(FILE_LIMIT));
  return { files, unreadable, warnings: [...warnings] };
}

function changesBetween(before: DirectorySnapshot, after: DirectorySnapshot): SavedChange[] {
  const unreadable = new Set([...before.unreadable, ...after.unreadable]);
  return [...new Set([...Object.keys(before.files), ...Object.keys(after.files)])]
    .sort()
    .flatMap((path) => {
      if (unreadable.has(path)) return [];
      const old = before.files[path] ?? null,
        current = after.files[path] ?? null;
      return old?.fingerprint === current?.fingerprint && old?.mode === current?.mode
        ? []
        : [{ path, before: old, after: current }];
    });
}

function fileSummary(file: SavedChange): FileChangeSummary {
  return {
    path: file.path,
    status: !file.before ? 'added' : !file.after ? 'deleted' : 'modified',
    beforeBytes: file.before?.bytes ?? null,
    afterBytes: file.after?.bytes ?? null,
    textDiff:
      (!file.before || file.before.text !== null) && (!file.after || file.after.text !== null),
  };
}

function detail(file: SavedChange, gitPatch?: string): FileChangeDetail {
  const summary = fileSummary(file);
  const patch =
    gitPatch ??
    (summary.textDiff
      ? (createTwoFilesPatch(
          file.before ? `a/${file.path}` : '/dev/null',
          file.after ? `b/${file.path}` : '/dev/null',
          file.before?.text ?? '',
          file.after?.text ?? '',
          undefined,
          undefined,
          { context: 3, timeout: 100 },
        ) ?? null)
      : null);
  return {
    ...summary,
    before: file.before?.text ?? null,
    after: file.after?.text ?? null,
    patch,
    note:
      file.before?.note ??
      file.after?.note ??
      (summary.textDiff && patch === null ? '差异计算超时，仍可读取前后文本' : null),
  };
}

function changesRoot() {
  return join(app.getPath('userData'), 'chat-changes');
}
function sessionDirectory(sessionId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) throw new Error('无效会话标识');
  return join(changesRoot(), sessionId);
}
function turnPath(sessionId: string, turnId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(turnId)) throw new Error('无效轮次标识');
  return join(sessionDirectory(sessionId), `${turnId}.json.gz`);
}

export async function freezeTurnChanges(
  sessionId: string,
  turnId: string,
  cwd: string,
  startedAt: string,
  runStatus: TurnChanges['runStatus'],
  before: DirectorySnapshot | null,
  unavailableReason?: string,
): Promise<void> {
  let files: SavedChange[] = [],
    warnings = before?.warnings ?? [],
    state: TurnChanges['state'] = 'unavailable';
  if (before) {
    try {
      const after = await captureDirectory(cwd, Object.keys(before.files));
      files = changesBetween(before, after);
      warnings = [...new Set([...warnings, ...after.warnings])];
      state = warnings.length ? 'partial' : 'complete';
    } catch (error) {
      warnings = [...warnings, errorText(error)];
    }
  } else warnings = [unavailableReason ?? '未能记录轮前状态'];
  const saved: SavedTurn = {
    turnId,
    cwd,
    startedAt,
    finishedAt: new Date().toISOString(),
    runStatus,
    state,
    warnings,
    files,
  };
  const path = turnPath(sessionId, turnId);
  await mkdir(sessionDirectory(sessionId), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, await compress(JSON.stringify(saved)));
  await rename(temporary, path);
}

async function loadTurn(sessionId: string, turnId: string): Promise<SavedTurn | null> {
  try {
    return JSON.parse(
      (
        await decompress(await readFile(turnPath(sessionId, turnId)), {
          maxOutputLength: 256 * 1024 * 1024,
        })
      ).toString('utf8'),
    ) as SavedTurn;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function readTurnChanges(
  sessionId: string,
  turnId: string,
  includeStats = false,
): Promise<TurnChanges | null> {
  const saved = await loadTurn(sessionId, turnId);
  if (!saved) return null;
  const files: FileChangeSummary[] = [];
  for (const file of saved.files) {
    files.push({
      ...fileSummary(file),
      ...(includeStats ? { stat: diffStatOf(detail(file).patch) } : {}),
    });
    // 一次解压后顺序统计，文件间让出主进程，不并发保留整轮文本副本。
    if (includeStats) await new Promise<void>((resolve) => setImmediate(resolve));
  }
  return { ...saved, files };
}

export async function listTurnChanges(sessionId: string): Promise<TurnChanges[]> {
  let names: string[];
  try {
    names = await readdir(sessionDirectory(sessionId));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const turns: TurnChanges[] = [];
  for (const name of names.filter((name) => /^[0-9a-f-]{36}\.json\.gz$/i.test(name))) {
    const turn = await readTurnChanges(sessionId, name.slice(0, 36));
    if (turn) turns.push(turn);
  }
  return turns.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export async function readTurnFileChange(
  sessionId: string,
  turnId: string,
  path: string,
): Promise<FileChangeDetail> {
  const file = (await loadTurn(sessionId, turnId))?.files.find((file) => file.path === path);
  if (!file) throw new Error('本轮没有此文件的变更记录');
  return detail(file);
}

export async function deleteTurnChanges(sessionId: string): Promise<void> {
  await rm(sessionDirectory(sessionId), { recursive: true, force: true });
}

async function uncommitted(
  cwd: string,
  requestedPath?: string,
): Promise<{ summary: UncommittedChanges; files: SavedChange[] }> {
  cwd = await realpath(cwd);
  if (requestedPath !== undefined) {
    const target = resolve(cwd, requestedPath);
    if (!inside(cwd, target) || target === cwd) throw new Error('文件路径超出工作目录或指向目录');
    requestedPath = slash(relative(cwd, target));
    if (!included(requestedPath)) throw new Error('此文件不在审阅范围内');
  }
  const pathspec = requestedPath === undefined ? '.' : `:(literal)${requestedPath}`;
  const repo = await repository(cwd);
  const summary: UncommittedChanges = {
    available: !!repo.root,
    reason: repo.root ? null : repo.missing ? 'git-unavailable' : 'not-git',
    cwd,
    repositoryRoot: repo.root,
    head: null,
    warnings: [],
    files: [],
  };
  if (!repo.root) return { summary, files: [] };
  try {
    summary.head = (await command(cwd, 'git', ['rev-parse', '--verify', 'HEAD']))
      .toString('utf8')
      .trim();
  } catch {
    // 只有尚无首个提交可用空树；损坏的 HEAD 等错误不伪装为新仓库。
    await command(cwd, 'git', ['symbolic-ref', 'HEAD']);
  }
  const paths = summary.head
    ? [
        ...(
          await command(cwd, 'git', [
            'diff',
            '--relative',
            '--no-ext-diff',
            '--no-textconv',
            '--no-renames',
            '--name-only',
            '-z',
            summary.head,
            '--',
            pathspec,
          ])
        )
          .toString('utf8')
          .split('\0'),
        ...(
          await command(cwd, 'git', [
            'ls-files',
            '--others',
            '--exclude-standard',
            '-z',
            '--',
            pathspec,
          ])
        )
          .toString('utf8')
          .split('\0'),
      ]
    : requestedPath === undefined
      ? await pathsIn(cwd)
      : (
          await command(cwd, 'git', [
            'ls-files',
            '--cached',
            '--others',
            '--exclude-standard',
            '-z',
            '--',
            pathspec,
          ])
        )
          .toString('utf8')
          .split('\0');
  const before: DirectorySnapshot = { files: Object.create(null), unreadable: [], warnings: [] };
  const after: DirectorySnapshot = { files: Object.create(null), unreadable: [], warnings: [] };
  const oldBudget = { remaining: TEXT_BUDGET },
    newBudget = { remaining: TEXT_BUDGET };
  const selected = [...new Set(paths.filter(Boolean).map(slash))]
    .filter((path) => included(path) && (requestedPath === undefined || path === requestedPath))
    .sort();
  if (selected.length > FILE_LIMIT) summary.warnings.push('变更超过 10,000 个文件，列表不完整');
  for (const path of selected.slice(0, FILE_LIMIT)) {
    try {
      if (!inside(cwd, resolve(cwd, path))) throw new Error('Git 路径超出工作目录');
      const current = await diskState(cwd, path, newBudget);
      if (current) current.mode = current.mode & 0o111 ? 0o755 : 0o644;
      if (current) after.files[path] = current;
      if (!summary.head) continue;
      const gitPath = slash(relative(repo.root!, resolve(cwd, path)));
      const entry = (
        await command(repo.root!, 'git', [
          'ls-tree',
          '-z',
          summary.head,
          '--',
          `:(literal)${gitPath}`,
        ])
      ).toString('utf8');
      if (!entry) continue;
      const [mode, type, objectId] = entry.slice(0, entry.indexOf('\t')).split(' ');
      if (type !== 'blob' || mode === '120000') {
        before.unreadable.push(path);
        summary.warnings.push(`${path}: 符号链接或子模块暂不提供 diff`);
        continue;
      }
      const size = Number(
        (await command(cwd, 'git', ['cat-file', '-s', objectId!])).toString('utf8'),
      );
      const old =
        size > HASH_BYTE_LIMIT
          ? {
              bytes: size,
              mode: 0,
              fingerprint: `git:${objectId}`,
              text: null,
              note: '文件超过 16 MiB，不提供文本 diff',
            }
          : stateOf(await command(cwd, 'git', ['cat-file', 'blob', objectId!]), oldBudget);
      old.mode = mode === '100755' ? 0o755 : 0o644;
      // Git 在 Windows 不追踪 POSIX 权限，避免每个文件都因 mode 显示为改动。
      if (process.platform === 'win32' && current) current.mode = old.mode;
      before.files[path] = old;
    } catch (error) {
      before.unreadable.push(path);
      summary.warnings.push(`${path}: ${errorText(error)}`);
    }
  }
  const files = changesBetween(before, after);
  summary.warnings = [
    ...new Set([
      ...summary.warnings,
      ...files.flatMap((file) =>
        [file.before?.note, file.after?.note].filter((note): note is string => !!note),
      ),
    ]),
  ];
  summary.files = files.map(fileSummary);
  return { summary, files };
}

export async function readUncommittedChanges(cwd: string): Promise<UncommittedChanges> {
  return (await uncommitted(cwd)).summary;
}
export async function readUncommittedFileChange(
  cwd: string,
  path: string,
): Promise<FileChangeDetail> {
  const { summary, files } = await uncommitted(cwd, path);
  const file = files[0];
  if (!file) throw new Error('此文件当前没有未提交改动');
  if (summary.head && file.before && fileSummary(file).textDiff) {
    // Git 对已跟踪文件按仓库属性比较，避免把工作树 CRLF 与 blob LF 当作整文件替换。
    const patch = (
      await command(summary.cwd, 'git', [
        'diff',
        '--no-ext-diff',
        '--no-textconv',
        '--no-renames',
        '--no-color',
        '--unified=3',
        summary.head,
        '--',
        `:(literal)${file.path}`,
      ])
    ).toString('utf8');
    return detail(file, patch);
  }
  return detail(file);
}

/** 顶层探测：只判断会话目录能否做未提交改动审阅，不做文件扫描。
 *  供打开审阅入口的可见性判定使用——全量扫描的代价不该花在「要不要显示按钮」上。 */
export async function probeUncommitted(
  cwd: string,
): Promise<{ available: boolean; reason: 'not-git' | 'git-unavailable' | null }> {
  const repo = await repository(cwd);
  return {
    available: !!repo.root,
    reason: repo.root ? null : repo.missing ? 'git-unavailable' : 'not-git',
  };
}
