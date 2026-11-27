import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Cloud, CloudUpload, FileText, FolderOpen, RefreshCw } from 'lucide-react';
import type {
  RemoteSkillUpload,
  SkillOrigin,
  SkillView,
} from '../../../../core/protocol/capabilities';
import type { WorkspaceEntry } from '../../../workspace/contract';
import { Button } from '../../../../ui/button';
import { Card } from '../../../../ui/card';
import { Switch } from '../../../../ui/switch';
import { SegmentedControl } from '../../../../ui/segmented-control';
import { useWorkspaceStore } from '../../../workspace/view';
import { showToast } from '../../../../ui/toast';
import { cn } from '../../../../ui/lib/cn';
import { SectionHeader } from '../SectionHeader';
import { SettingsGroup } from '../SettingsGroup';
import { ErrorText } from '../../../../ui/error-text';
import { Spinner } from '../../../../ui/spinner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '../../../../ui/dialog';
import { capabilitiesClient } from '../../../chat/view';
import { errorMessage } from '../../../../core/protocol/contract';

const ORIGINS = ['builtin', 'user', 'project'] as const;
const ORIGIN_LABELS: Record<SkillOrigin, string> = {
  builtin: '内置',
  user: '本机',
  project: '项目',
};
const FILTER_LABELS: Record<'all' | SkillOrigin, string> = {
  all: '全部',
  ...ORIGIN_LABELS,
};
const ORIGIN_DESCRIPTIONS: Record<SkillOrigin, string> = {
  builtin: '随 Dela 安装，写在 ~/.dela/skills',
  user: '~/.dela/skills 与 ~/.agents/skills 里你自己放的',
  project: '项目里的 .agents/skills',
};

interface SkillGroup {
  key: string;
  origin: SkillOrigin;
  title: string;
  items: SkillView[];
}

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

const remoteProjectsOf = (entries: WorkspaceEntry[]) =>
  entries.filter(
    (entry): entry is WorkspaceEntry & { path: string } =>
      entry.kind === 'project' && !!entry.remoteId && !!entry.path,
  );

export function SkillsTab() {
  const queryClient = useQueryClient();
  const setSkills = (views: SkillView[] | undefined) =>
    queryClient.setQueryData(['capabilities', 'skills'], views);
  // 未读到列表（data 为 undefined）时不渲染空态，避免闪烁。
  const list = useQuery({
    queryKey: ['capabilities', 'skills'],
    queryFn: () => capabilitiesClient.listSkills(),
    enabled: Boolean(window.dela),
  });
  const skills = list.data;
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<'all' | SkillOrigin>('all');
  const [viewing, setViewing] = useState<SkillView | null>(null);
  const [uploading, setUploading] = useState<SkillView | null>(null);

  const refresh = () => void list.refetch();

  const toggle = async (skill: SkillView, next: boolean) => {
    if (!window.dela || busy) return;
    setBusy(true);
    const previous = skills;
    setSkills(
      (previous ?? []).map((item) => (item.id === skill.id ? { ...item, enabled: next } : item)),
    );
    try {
      setSkills(await capabilitiesClient.setSkillEnabled({ id: skill.id, enabled: next }));
    } catch (cause) {
      setSkills(previous);
      showToast({ variant: 'error', title: '保存失败', description: errorMessage(cause) });
    }
    setBusy(false);
  };

  // 目录可能已被删除，reveal 失败要经 toast 提示。
  const reveal = (skill: SkillView) => {
    void capabilitiesClient.revealSkill(skill.id).catch((cause) =>
      showToast({
        variant: 'error',
        title: '打开所在位置失败',
        description: errorMessage(cause),
      }),
    );
  };

  if (!window.dela) {
    return (
      <div className="grid gap-10">
        <SectionHeader title="Skills" />
        <p className="text-sm text-ink-3">Skills 仅在桌面端可用。</p>
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
      {skills && skills.length > 0 && (
        <div className="flex items-center justify-between gap-4">
          <SegmentedControl
            labels={FILTER_LABELS}
            onValueChange={setFilter}
            options={['all', ...origins]}
            value={filter}
          />
          <span className="text-xs tabular-nums text-ink-3">{visible.length} 项</span>
        </div>
      )}
      {skills?.length === 0 && (
        <SettingsGroup>
          <div className="grid gap-1 py-3.5">
            <span className="text-sm font-medium text-ink">还没有发现 Skill</span>
            <span className="text-xs leading-relaxed text-ink-3">
              在用户主目录的 .dela/skills 或 .agents/skills，或项目里的 .agents/skills 放入包含
              SKILL.md 的子文件夹（frontmatter 带 name 与 description），回到此页刷新。
            </span>
          </div>
        </SettingsGroup>
      )}
      {skills && skills.length > 0 && visible.length === 0 && (
        <SettingsGroup>
          <p className="py-3.5 text-sm text-ink-3">该范围下没有 Skill。</p>
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
                    className="grid size-8 shrink-0 place-items-center rounded-card bg-fill text-sm font-medium uppercase text-ink-2"
                  >
                    {skill.name.charAt(0)}
                  </span>
                  <div className="grid min-w-0 gap-0.5">
                    <strong className="truncate text-sm">{skill.name}</strong>
                    <span className="truncate text-xs text-ink-3" title={skill.description}>
                      {skill.description || '（无描述）'}
                    </span>
                    <span className="truncate font-mono text-xs text-ink-3" title={skill.path}>
                      {skill.path}
                    </span>
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
                    onClick={() => setUploading(skill)}
                    size="icon-sm"
                    title="上传到远端项目"
                    variant="ghost"
                  >
                    <CloudUpload />
                  </Button>
                  <Switch
                    checked={skill.enabled}
                    disabled={busy}
                    aria-label={`启用 ${skill.name}`}
                    onCheckedChange={(next) => void toggle(skill, next)}
                  />
                </div>
              </li>
            ))}
          </ul>
        </SettingsGroup>
      ))}
      {list.error && <ErrorText>{errorMessage(list.error)}</ErrorText>}
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

function SkillContentView({
  onClose,
  onReveal,
  skill,
}: {
  onClose: () => void;
  onReveal: () => void;
  skill: SkillView;
}) {
  const { data: content, error } = useQuery({
    queryKey: ['capabilities', 'skillContent', skill.id],
    queryFn: () => capabilitiesClient.readSkill(skill.id),
  });

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      open
    >
      <DialogContent size="xl" scroll className="grid grid-rows-[auto_auto_minmax(0,1fr)_auto]">
        <DialogTitle>{skill.name}</DialogTitle>
        <DialogDescription className="truncate font-mono" title={skill.path}>
          {skill.path}
        </DialogDescription>
        <Card className="mt-3 min-h-32 overflow-y-auto" variant="inset">
          {content === undefined && !error ? (
            <p className="flex items-center gap-2 text-xs text-ink-3" role="status">
              <Spinner />
              正在读取…
            </p>
          ) : (
            <pre className="font-mono text-xs leading-relaxed [overflow-wrap:anywhere] whitespace-pre-wrap text-ink-2">
              {content}
            </pre>
          )}
          {error && <ErrorText>{errorMessage(error)}</ErrorText>}
        </Card>
        <div className="mt-3 flex items-center justify-end gap-2">
          <Button onClick={onReveal} size="sm" variant="ghost">
            <FolderOpen />
            打开所在位置
          </Button>
          <Button onClick={onClose} size="sm" variant="secondary">
            关闭
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SkillUploadDialog({ onClose, skill }: { onClose: () => void; skill: SkillView }) {
  const projects = remoteProjectsOf(useWorkspaceStore((state) => state.workspace.entries));
  const [projectId, setProjectId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // true 表示远端已有同名技能：显示覆盖确认，点「覆盖」才用 overwrite=true 重试。
  const [conflict, setConflict] = useState(false);
  const [uploaded, setUploaded] = useState<RemoteSkillUpload | null>(null);
  const project = projects.find((entry) => entry.id === projectId);

  const upload = async (overwrite: boolean) => {
    if (!window.dela || busy || !project) return;
    setBusy(true);
    try {
      setUploaded(
        await capabilitiesClient.uploadSkillToRemote({
          id: skill.id,
          remotePath: project.path,
          overwrite,
        }),
      );
      setConflict(false);
    } catch (cause) {
      const message = errorMessage(cause);
      const exists = message.startsWith(REMOTE_EXISTS_PREFIX);
      setConflict(exists);
      if (!exists) showToast({ variant: 'error', title: '上传失败', description: message });
    }
    setBusy(false);
  };

  return (
    <Dialog onOpenChange={(open) => !open && !busy && onClose()} open>
      <DialogContent scroll>
        <DialogTitle>上传到远端项目</DialogTitle>
        <DialogDescription>
          把技能 {skill.name} 的目录（含附属文件）上传到远端项目的 .agents/skills/{skill.name}
          /，远端会话即可使用。
        </DialogDescription>
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
                    'flex w-full min-w-0 items-center gap-2.5 rounded-control border px-3 py-2 text-left transition-colors duration-base disabled:opacity-50',
                    entry.id === projectId
                      ? 'border-line-strong bg-selected'
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
                    <span className="truncate text-sm text-ink">{entry.name}</span>
                    <span className="truncate font-mono text-xs text-ink-3" title={entry.path}>
                      {entry.path}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <DialogFooter>
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
                {busy && <Spinner />}
                {busy ? '上传中…' : '上传'}
              </Button>
            ))}
          <Button disabled={busy} onClick={onClose} size="sm" variant="ghost">
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
