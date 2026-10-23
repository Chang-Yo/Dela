/**
 * 远端上下文镜像：远端 AGENTS.md 与三处 skills 落到本地，Pi 才读得到——Pi 的 skills 只认本地文件
 * （写进系统提示的是 `filePath`，`/skill:name` 展开是本地 `readFileSync`），镜像路径再由 `remotePath` 翻回远端。
 * AGENTS.md 不镜像，内容经 `agentsFilesOverride` 直接交给 Pi、`path` 写远端路径；同步只跑一次远端脚本，
 * 不做全量仓库镜像，也不监听远端变化。
 */
import { app } from 'electron';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { helperSession } from './helper';
import { remoteOperations, setContextMirrors, writeRemoteFile } from './operations';
import { shellQuote, type RemoteTarget } from './transport';

/** Pi 认的上下文文件名，顺序即优先级（与 resource-loader 的候选一致）。 */
const CONTEXT_FILE_NAMES = [
  'AGENTS.override.md',
  'AGENTS.md',
  'AGENTS.MD',
  'CLAUDE.md',
  'CLAUDE.MD',
];

/** 仓库内两处 skills（优先级从高到低）与服务器主目录下的一处。 */
const REPO_SKILL_DIRS = ['.agents/skills', '.dela/skills'];
const HOME_SKILL_DIR = '.dela/skills';

/** 单个镜像文件的上限：skill 不该带大文件，超限的直接跳过（find 里过滤，不占传输）。 */
const MIRROR_FILE_LIMIT = '1048576c';
/** 同步一次的总超时（秒）：取回的是纯文本，正常远小于它；卡住就走降级（没有远端 skills）。 */
const SYNC_TIMEOUT_SECONDS = 30;

const HOME_MARK = '@@HOME';
const SKILLS_MARK = '@@SKILLS';
const AGENTS_MARK = '@@AGENTS';
const END_MARK = '@@END';

interface Record {
  path: string;
  content: Buffer;
}

/** 一次 ssh 取回全部内容：NUL 分隔的「路径 + base64 正文」记录，用标记分段。
 *  NUL 不会出现在路径与 base64 里，所以空文件也能正确解析。 */
function mirrorScript(home: string, remoteDir: string, ancestors: string[]): string {
  const sections: string[] = [`printf '${HOME_MARK}\\0%s\\0' "$HOME"`];

  const skillSections: { label: string; dir: string }[] = [
    ...REPO_SKILL_DIRS.map((name) => ({ label: `repo:${name}`, dir: `${remoteDir}/${name}` })),
    { label: `home:${HOME_SKILL_DIR}`, dir: `${home}/${HOME_SKILL_DIR}` },
  ];
  for (const { label, dir } of skillSections) {
    sections.push(
      `printf '${SKILLS_MARK}\\0%s\\0' ${shellQuote(label)}`,
      `if [ -d ${shellQuote(dir)} ]; then (cd ${shellQuote(dir)} && find . -type f -size -${MIRROR_FILE_LIMIT} -not -path './.git/*' | LC_ALL=C sort | while IFS= read -r f; do printf '%s\\0' "$f"; base64 < "$f" | tr -d '\\n'; printf '\\0'; done); fi`,
      `printf '${END_MARK}\\0'`,
    );
  }

  sections.push(`printf '${AGENTS_MARK}\\0'`);
  const names = CONTEXT_FILE_NAMES.map((name) => shellQuote(name)).join(' ');
  for (const dir of ancestors) {
    sections.push(
      `_p=""; for _f in ${names}; do if [ -f ${shellQuote(dir)}/"$_f" ]; then _p=${shellQuote(dir)}/"$_f"; break; fi; done`,
      `if [ -n "$_p" ]; then printf '%s\\0' "$_p"; base64 < "$_p" | tr -d '\\n'; printf '\\0'; fi`,
    );
  }
  return sections.join('\n');
}

/** 远端 cwd 的祖先目录，从根往下（与 Pi 的注入顺序一致）。 */
function ancestorsOf(remoteDir: string): string[] {
  const parts = remoteDir.split('/').filter(Boolean);
  const dirs = ['/'];
  let current = '';
  for (const part of parts) {
    current += `/${part}`;
    dirs.push(current);
  }
  return dirs;
}

function parseRecords(stdout: Buffer): {
  home: string | null;
  skills: Map<string, Record[]>;
  agentsFiles: { path: string; content: string }[];
} {
  const tokens = stdout.toString('utf8').split('\0');
  const skills = new Map<string, Record[]>();
  const agentsFiles: { path: string; content: string }[] = [];
  let home: string | null = null;
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index]!;
    index += 1;
    if (token === HOME_MARK) {
      home = tokens[index] ?? null;
      index += 1;
    } else if (token === SKILLS_MARK) {
      const label = tokens[index] ?? '';
      index += 1;
      const records: Record[] = [];
      while (index + 1 < tokens.length && !tokens[index]!.startsWith('@@')) {
        records.push({ path: tokens[index]!, content: Buffer.from(tokens[index + 1]!, 'base64') });
        index += 2;
      }
      skills.set(label, records);
    } else if (token === AGENTS_MARK) {
      while (index + 1 < tokens.length && !tokens[index]!.startsWith('@@')) {
        agentsFiles.push({
          path: tokens[index]!,
          // Pi 读本地文件时会去 BOM，这里保持一致，免得远端文件头多一个看不见的字符。
          content: Buffer.from(tokens[index + 1]!, 'base64')
            .toString('utf8')
            .replace(/^\uFEFF/, ''),
        });
        index += 2;
      }
    }
  }
  return { home, skills, agentsFiles };
}

/** 镜像根：每个远端项目一份，路径稳定（同一项目的旧会话与新会话看到同一批镜像路径）。
 *  项目 id 可能是「远端条目 id」这类带 `/` `:` 的字符串，只留安全字符再当目录名。 */
export function contextMirrorRoot(remoteId: string, projectId: string): string {
  const safe = projectId.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 100);
  return join(app.getPath('userData'), 'remote-context', remoteId, safe);
}

function writeMirror(dir: string, records: Record[]): string | null {
  rmSync(dir, { recursive: true, force: true });
  if (records.length === 0) return null;
  for (const record of records) {
    const target = join(dir, record.path.replace(/^\.\//, ''));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, record.content);
  }
  return dir;
}

export interface RemoteContext {
  /** 可交给 Pi 的 skill 目录（镜像里真实存在的那些）。 */
  skillPaths: string[];
  /** 远端 AGENTS.md：内容给 Pi，path 写远端路径。 */
  agentsFiles: { path: string; content: string }[];
}

/**
 * 同步一个远端项目的上下文。失败不抛：没有远端 skills/AGENTS.md 只是少了上下文，
 * 不该让会话打不开——调用方拿到空结果即可。
 */
export async function syncRemoteContext(input: {
  target: RemoteTarget;
  /** 镜像路由 key，例如 `<remoteId>:<projectId>`。 */
  key: string;
  remoteId: string;
  projectId: string;
  remoteDir: string;
  /** 已知的远端主目录；缺省时用远端 `$HOME`。 */
  home?: string | null;
}): Promise<RemoteContext> {
  const mirrorRoot = contextMirrorRoot(input.remoteId, input.projectId);
  const empty: RemoteContext = { skillPaths: [], agentsFiles: [] };
  try {
    const { exec } = remoteOperations(input.target).bash;
    const script = mirrorScript(
      input.home ?? '$HOME',
      input.remoteDir,
      ancestorsOf(input.remoteDir),
    );
    const chunks: Buffer[] = [];
    const result = await exec(script, '/', {
      onData: (chunk) => chunks.push(chunk),
      timeout: SYNC_TIMEOUT_SECONDS,
    });
    if (result.exitCode !== 0)
      throw new Error(
        `镜像脚本退出码 ${String(result.exitCode)}：${Buffer.concat(chunks).toString('utf8').slice(0, 200)}`,
      );
    const { home, skills, agentsFiles } = parseRecords(Buffer.concat(chunks));
    const homeDir = input.home ?? home;
    if (!homeDir?.startsWith('/')) throw new Error('未能确定远端主目录');

    const skillPaths: string[] = [];
    for (const name of REPO_SKILL_DIRS) {
      const dir = writeMirror(join(mirrorRoot, 'repo', name), skills.get(`repo:${name}`) ?? []);
      if (dir) skillPaths.push(dir);
    }
    const homeSkills = writeMirror(
      join(mirrorRoot, 'home', HOME_SKILL_DIR),
      skills.get(`home:${HOME_SKILL_DIR}`) ?? [],
    );
    if (homeSkills) skillPaths.push(homeSkills);

    setContextMirrors(input.key, [
      { mirror: join(mirrorRoot, 'repo'), remote: input.remoteDir },
      { mirror: join(mirrorRoot, 'home'), remote: homeDir },
    ]);
    return { skillPaths, agentsFiles };
  } catch (error) {
    console.warn('[remotes] 远端上下文镜像失败，本次会话不带远端 skills/AGENTS.md', error);
    setContextMirrors(input.key, []);
    return empty;
  }
}

/** 本地技能目录里的文件（相对目录）：软链接不跟随，避免把仓库外的东西一起带走。 */
function skillFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)));
}

/**
 * 把本地技能目录上传到远端项目的 `.dela/skills/<名字>/`（含附属文件，随仓库进 git）。
 * 目标已存在且 overwrite=false 时抛「远端已存在：…」，由调用方先问用户；
 * 技能里的脚本在远端执行，用远端自己的 Node/Python。
 */
export async function uploadSkillToRemote(input: {
  target: RemoteTarget;
  skillDir: string;
  name: string;
  remoteDir: string;
  overwrite: boolean;
}): Promise<{ path: string; files: number }> {
  const destination = `${input.remoteDir}/${REPO_SKILL_DIRS[1]}/${input.name}`;
  if (!input.overwrite && (await helperSession(input.target).stat([destination]))[0]?.exists)
    throw new Error(`远端已存在：${destination}`);

  const files = skillFiles(input.skillDir);
  for (const file of files) {
    await writeRemoteFile(
      input.target,
      `${destination}/${file.replace(/\\/g, '/')}`,
      readFileSync(join(input.skillDir, file)),
    );
  }
  return { path: destination, files: files.length };
}
