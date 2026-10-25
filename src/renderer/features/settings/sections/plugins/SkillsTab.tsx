import { useEffect, useRef, useState } from 'react';
import { Dialog } from 'radix-ui';
import { Cloud, CloudUpload, FileText, FolderOpen, LoaderCircle, RefreshCw } from 'lucide-react';
import type { SkillOrigin, SkillView, WorkspaceEntry } from '../../../../../shared/api';
import type { RemoteSkillUpload } from '../../../../../shared/capabilities';
import { Button } from '../../../../components/ui/button';
import { DownloadProgressRow } from '../../../../components/download-progress';
import { Switch } from '@/components/ui/beautifului/atoms/Switch';
import { SegmentedControl } from '@/components/ui/beautifului/atoms/SegmentedControl';
import { errorText, useWorkspaceStore } from '../../../../workspace/store';
import { showToast } from '../../../../app/toasts';
import { cn } from '../../../../lib/utils';
import { dialogOverlay, dialogPanel } from '../../../../components/ui/motion';
import { SectionHeader } from '../../SectionHeader';
import { SettingsGroup } from '../../SettingsGroup';

const ORIGINS = ['builtin', 'user', 'package', 'project'] as const;
const ORIGIN_LABELS: Record<SkillOrigin, string> = {
  builtin: '内置',
  user: '本机',
  package: 'Pi Packages',
  project: '项目',
};
const FILTER_LABELS: Record<'all' | SkillOrigin, string> = {
  all: '全部',
  ...ORIGIN_LABELS,
};
const ORIGIN_DESCRIPTIONS: Record<SkillOrigin, string> = {
  builtin: '随 Dela 安装，写在 ~/.dela/skills',
  user: '~/.dela/skills 与 ~/.agents/skills 里你自己放的',
  package: 'Pi Package',
  project: '项目里的 .agents/skills、.pi/skills 与 .agent/skills',
};

interface SkillGroup {
  key: string;
  origin: SkillOrigin;
  title: string;
  items: SkillView[];
}

/** 内置、本机各一组；每个包、每个项目各一组。组的顺序按来处，组内保持主进程给的顺序。 */
function groupSkills(skills: SkillView[]): SkillGroup[] {
  const groups: SkillGroup[] = [];
  for (const skill of skills) {
    const key = skill.group ? `${skill.origin}:${skill.group.id}` : skill.origin;
    let group = groups.find((item) => item.key === key);
    if (!group) {
      group = {
        key,
        origin: skill.origin,
        title: skill.group?.label ?? (skill.origin === 'builtin' ? 'Dela 内置' : '本机'),
        items: [],
      };
      groups.push(group);
    }
    group.items.push(skill);
  }
  return groups.sort((left, right) => ORIGINS.indexOf(left.origin) - ORIGINS.indexOf(right.origin));
}

/** 目标已存在时主进程拒绝的固定前缀：据此把冲突转成覆盖确认，而不是错误。 */
const REMOTE_EXISTS_PREFIX = '远端已存在：';

/** 可作上传目标的远端项目：path 是远端 POSIX 根目录，本地没有对应文件。 */
const remoteProjectsOf = (entries: WorkspaceEntry[]) =>
  entries.filter(
    (entry): entry is WorkspaceEntry & { path: string } =>
      entry.kind === 'project' && !!entry.remoteId && !!entry.path,
  );

/** 设置 › Skills：内置、本机目录、Pi package 与每个本地项目的技能，分组列出并逐个启停。 */
export function SkillsTab() {
  // null 表示尚未读到列表，避免闪烁出错误的空态。
  const [skills, setSkills] = useState<SkillView[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [installing, setInstalling] = useState(false);
  const cancelRequested = useRef(false);
  const [error, setError] = useState<string | null>(null);
  // 按来处过滤：全部 / 内置 / 本机 / Pi Packages / 项目（只列有内容的来处）。
  const [filter, setFilter] = useState<'all' | SkillOrigin>('all');
  const [viewing, setViewing] = useState<SkillView | null>(null);
  const [uploading, setUploading] = useState<SkillView | null>(null);

  const refresh = () => {
    void window.dela?.capability
      .listSkills()
      .then(setSkills)
      .catch((cause) => setError(errorText(cause)));
  };

  useEffect(() => {
    refresh();
  }, []);

  const dependencyInstalling =
    installing || skills?.some((skill) => skill.dependency?.status === 'installing');
  useEffect(() => {
    if (!dependencyInstalling) return;
    const timer = window.setInterval(refresh, 1000);
    return () => window.clearInterval(timer);
  }, [dependencyInstalling]);

  const install = async (skill: SkillView) => {
    if (!window.dela || installing) return;
    cancelRequested.current = false;
    setInstalling(true);
    try {
      setSkills(await window.dela.capability.installSkillDependencies(skill.name));
    } catch (cause) {
      refresh();
      if (!cancelRequested.current)
        showToast({ variant: 'error', title: '组件安装未完成', description: errorText(cause) });
    } finally {
      setInstalling(false);
    }
  };

  const cancelInstallation = async (name: string) => {
    cancelRequested.current = true;
    try {
      await window.dela?.capability.cancelSkillInstallation(name);
    } catch (cause) {
      cancelRequested.current = false;
      showToast({ variant: 'error', title: '取消失败', description: errorText(cause) });
    }
  };

  // 即时保存 + 失败回滚（与通知/工作区页签一致）。
  const toggle = async (skill: SkillView, next: boolean) => {
    if (!window.dela || busy) return;
    setBusy(true);
    const previous = skills;
    setSkills(
      (previous ?? []).map((item) => (item.id === skill.id ? { ...item, enabled: next } : item)),
    );
    try {
      setSkills(await window.dela.capability.setSkillEnabled(skill.id, next));
    } catch (cause) {
      setSkills(previous);
      showToast({ variant: 'error', title: '保存失败', description: errorText(cause) });
    } finally {
      setBusy(false);
    }
  };

  // 目录可能已被删除，reveal 失败要经 toast 提示。
  const reveal = (skill: SkillView) => {
    void window.dela?.capability
      .revealSkill(skill.id)
      .catch((cause) =>
        showToast({ variant: 'error', title: '打开所在位置失败', description: errorText(cause) }),
      );
  };

  if (!window.dela) {
    return (
      <div className="grid gap-10">
        <SectionHeader title="Skills" />
        <p className="text-13 text-ink-3">Skills 仅在桌面端可用。</p>
      </div>
    );
  }

  const origins = ORIGINS.filter((origin) => skills?.some((skill) => skill.origin === origin));
  const visible = (skills ?? []).filter((skill) => filter === 'all' || skill.origin === filter);
  const groups = groupSkills(visible);

  return (
    <div className="grid gap-10">
      <SectionHeader
        action={
          <Button aria-label="刷新技能列表" onClick={refresh} size="icon-sm" variant="ghost">
            <RefreshCw />
          </Button>
        }
        title="Skills"
      />
      {skills !== null && skills.length > 0 && (
        <div className="flex items-center justify-between gap-4">
          <SegmentedControl
            labels={FILTER_LABELS}
            onChange={setFilter}
            options={['all', ...origins]}
            value={filter}
          />
          <span className="text-xs tabular-nums text-ink-3">{visible.length} 项</span>
        </div>
      )}
      {skills !== null && skills.length === 0 && (
        <SettingsGroup>
          <div className="grid gap-1 py-3.5">
            <span className="text-13 font-medium text-ink">还没有发现 Skill</span>
            <span className="text-xs leading-relaxed text-ink-3">
              在用户主目录的 .dela/skills 或 .agents/skills，或项目里的
              .agents/skills、.agent/skills 放入包含 SKILL.md 的子文件夹（frontmatter 带 name 与
              description），回到此页刷新。
            </span>
          </div>
        </SettingsGroup>
      )}
      {skills !== null && skills.length > 0 && visible.length === 0 && (
        <SettingsGroup>
          <p className="py-3.5 text-13 text-ink-3">该范围下没有 Skill。</p>
        </SettingsGroup>
      )}
      {groups.map((group) => (
        <SettingsGroup
          description={ORIGIN_DESCRIPTIONS[group.origin]}
          key={group.key}
          title={group.title}
        >
          <ul className="grid">
            {group.items.map((skill) => (
              <li
                className="flex items-center justify-between gap-4 border-b py-3 last:border-0"
                key={skill.id}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    aria-hidden="true"
                    className="grid size-8 shrink-0 place-items-center rounded-card bg-hover-2 text-13 font-medium uppercase text-ink-2"
                  >
                    {skill.name.charAt(0)}
                  </span>
                  <div className="grid min-w-0 gap-0.5">
                    <strong className="truncate text-13">{skill.name}</strong>
                    <span className="truncate text-xs text-ink-3" title={skill.description}>
                      {skill.description || '（无描述）'}
                    </span>
                    <span className="truncate font-mono text-xs text-ink-3" title={skill.path}>
                      {skill.path}
                    </span>
                    {skill.lockedReason && (
                      <span className="text-xs text-ink-3">{skill.lockedReason}</span>
                    )}
                    {skill.dependency &&
                      skill.dependency.status !== 'ready' &&
                      (skill.dependency.status === 'error' ? (
                        <span
                          className="truncate text-xs text-red"
                          role="status"
                          title={skill.dependency.error}
                        >
                          {skill.dependency.error ?? '组件安装失败'}
                        </span>
                      ) : (
                        <span className="text-xs text-ink-3" role="status">
                          {skill.dependency.phase ?? '需要安装文档解析组件'}
                        </span>
                      ))}
                    {skill.dependency?.status === 'installing' && skill.dependency.total ? (
                      <DownloadProgressRow
                        barClassName="w-16 md:w-40"
                        label={`${skill.name} 组件下载进度`}
                        received={skill.dependency.received ?? 0}
                        total={skill.dependency.total}
                      />
                    ) : null}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    aria-label={`查看 ${skill.name}`}
                    onClick={() => setViewing(skill)}
                    size="icon-sm"
                    title="查看 SKILL.md"
                    variant="ghost"
                  >
                    <FileText />
                  </Button>
                  <Button
                    aria-label={`打开 ${skill.name} 所在位置`}
                    onClick={() => reveal(skill)}
                    size="icon-sm"
                    title="打开所在位置"
                    variant="ghost"
                  >
                    <FolderOpen />
                  </Button>
                  <Button
                    aria-label={`上传 ${skill.name} 到远端项目`}
                    disabled={!!skill.dependency}
                    onClick={() => setUploading(skill)}
                    size="icon-sm"
                    title={skill.dependency ? '此组件仅在本机使用' : '上传到远端项目'}
                    variant="ghost"
                  >
                    <CloudUpload />
                  </Button>
                  {skill.dependency && skill.dependency.status !== 'ready' ? (
                    skill.dependency.status === 'installing' || installing ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void cancelInstallation(skill.name)}
                      >
                        取消安装
                      </Button>
                    ) : (
                      <Button size="sm" onClick={() => void install(skill)}>
                        {skill.dependency.status === 'error' ? '重试安装' : '安装并启用'}
                      </Button>
                    )
                  ) : (
                    <Switch
                      checked={skill.enabled}
                      disabled={busy || !!skill.lockedReason}
                      label={`启用 ${skill.name}`}
                      onChange={(next) => void toggle(skill, next)}
                    />
                  )}
                </div>
              </li>
            ))}
          </ul>
        </SettingsGroup>
      ))}
      {error && (
        <p className="text-xs text-red" role="alert">
          {error}
        </p>
      )}
      {viewing && (
        <SkillContentView
          onClose={() => setViewing(null)}
          onReveal={() => reveal(viewing)}
          skill={viewing}
        />
      )}
      {uploading && <SkillUploadDialog onClose={() => setUploading(null)} skill={uploading} />}
    </div>
  );
}

/** SKILL.md 内容查看：渲染端传清单里的 id，主进程只读清单里有的路径。 */
function SkillContentView({
  onClose,
  onReveal,
  skill,
}: {
  onClose: () => void;
  onReveal: () => void;
  skill: SkillView;
}) {
  // null 表示正在读取；读取失败时展示错误并保留关闭入口。
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void window.dela?.capability
      .readSkill(skill.id)
      .then(setContent)
      .catch((cause) => setError(errorText(cause)));
  }, [skill.id]);

  return (
    <Dialog.Root
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      open
    >
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlay} />
        <Dialog.Content
          className={cn(
            dialogPanel,
            'grid max-h-[85vh] max-w-2xl grid-rows-[auto_auto_minmax(0,1fr)_auto] overflow-y-auto',
          )}
        >
          <Dialog.Title className="text-base font-semibold">{skill.name}</Dialog.Title>
          <Dialog.Description
            className="mt-1 truncate font-mono text-xs text-ink-3"
            title={skill.path}
          >
            {skill.path}
          </Dialog.Description>
          <div className="mt-3 min-h-32 overflow-y-auto rounded-card bg-inset p-3">
            {content === null && !error ? (
              <p className="flex items-center gap-2 text-xs text-ink-3" role="status">
                <LoaderCircle className="size-4 animate-spin" />
                正在读取…
              </p>
            ) : (
              <pre className="font-mono text-xs leading-relaxed [overflow-wrap:anywhere] whitespace-pre-wrap text-ink-2">
                {content}
              </pre>
            )}
            {error && (
              <p className="text-xs text-red" role="alert">
                {error}
              </p>
            )}
          </div>
          <div className="mt-3 flex items-center justify-end gap-2">
            <Button onClick={onReveal} size="sm" variant="ghost">
              <FolderOpen />
              打开所在位置
            </Button>
            <Button onClick={onClose} size="sm" variant="secondary">
              关闭
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** 上传 Skill 到远端项目：目标取自工作区里的远端项目，同名冲突时二次确认覆盖。 */
function SkillUploadDialog({ onClose, skill }: { onClose: () => void; skill: SkillView }) {
  const projects = remoteProjectsOf(useWorkspaceStore((state) => state.workspace.entries));
  const [projectId, setProjectId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // true 表示远端已有同名技能：显示覆盖确认，点「覆盖」才用 overwrite=true 重试。
  const [conflict, setConflict] = useState(false);
  const [uploaded, setUploaded] = useState<RemoteSkillUpload | null>(null);
  const project = projects.find((entry) => entry.id === projectId);

  const upload = async (overwrite: boolean) => {
    const dela = window.dela;
    if (!dela || busy || !project) return;
    setBusy(true);
    try {
      setUploaded(await dela.capability.uploadSkillToRemote(skill.id, project.path, overwrite));
      setConflict(false);
    } catch (cause) {
      const message = errorText(cause);
      const exists = message.startsWith(REMOTE_EXISTS_PREFIX);
      setConflict(exists);
      if (!exists) showToast({ variant: 'error', title: '上传失败', description: message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog.Root onOpenChange={(open) => !open && !busy && onClose()} open>
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlay} />
        <Dialog.Content className={cn(dialogPanel, 'max-h-[85vh] max-w-md overflow-y-auto')}>
          <Dialog.Title className="text-base font-semibold">上传到远端项目</Dialog.Title>
          <Dialog.Description className="mt-1 text-xs leading-relaxed text-ink-3">
            把技能 {skill.name} 的目录（含附属文件）上传到远端项目的 .dela/skills/{skill.name}
            /，远端会话即可使用。
          </Dialog.Description>
          {uploaded ? (
            <p className="mt-4 text-xs [overflow-wrap:anywhere] text-ink-2" role="status">
              已上传 {uploaded.files} 个文件到 {uploaded.path}
            </p>
          ) : projects.length === 0 ? (
            <p className="mt-4 text-xs text-ink-3">还没有远端项目。</p>
          ) : (
            <ul className="mt-4 grid gap-1">
              {projects.map((entry) => (
                <li key={entry.id}>
                  <button
                    aria-pressed={entry.id === projectId}
                    className={cn(
                      'flex w-full min-w-0 items-center gap-2.5 rounded-control border px-3 py-2 text-left transition-colors duration-150 disabled:opacity-50',
                      entry.id === projectId
                        ? 'border-line-strong bg-hover-2'
                        : 'border-line hover:bg-hover',
                    )}
                    disabled={busy}
                    onClick={() => {
                      setProjectId(entry.id);
                      setConflict(false);
                    }}
                    type="button"
                  >
                    <Cloud className="size-4 shrink-0 text-ink-3" strokeWidth={1.8} />
                    <span className="grid min-w-0">
                      <span className="truncate text-13 text-ink">{entry.name}</span>
                      <span className="truncate font-mono text-xs text-ink-3" title={entry.path}>
                        {entry.path}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4 flex items-center justify-end gap-2">
            {conflict && !uploaded && (
              <span className="mr-auto text-xs text-ink-2">远端已有同名技能，覆盖吗？</span>
            )}
            {!uploaded &&
              (conflict ? (
                <Button
                  disabled={busy}
                  onClick={() => void upload(true)}
                  size="sm"
                  variant="destructive"
                >
                  覆盖
                </Button>
              ) : (
                <Button disabled={busy || !project} onClick={() => void upload(false)} size="sm">
                  {busy && <LoaderCircle className="animate-spin" />}
                  {busy ? '上传中…' : '上传'}
                </Button>
              ))}
            <Button disabled={busy} onClick={onClose} size="sm" variant="ghost">
              关闭
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
