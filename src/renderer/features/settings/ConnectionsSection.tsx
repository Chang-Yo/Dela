import { useEffect, useState, type ReactNode } from 'react';
import { Dialog } from 'radix-ui';
import { CalendarDays, Folder, GraduationCap, Mail, type LucideIcon } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { cn } from '../../lib/utils';
import type { MailTrashRetention } from '../../../shared/api';
import { SectionHeader } from './SectionHeader';
import { errorText, useWorkspace } from '../projects/workspace';

type ConnectionsSectionProps = {
  onOpenMail: () => void;
  onOpenTimetable: () => void;
};

type Connection = {
  name: string;
  icon: LucideIcon;
  state: string;
  connected: boolean;
  description: string;
  actionLabel: string;
  onClick: () => void;
  /** 条目右侧的内联设置(如保留期);仅在相应数据就绪时渲染。 */
  extra?: ReactNode;
};

export function ConnectionsSection({ onOpenMail, onOpenTimetable }: ConnectionsSectionProps) {
  const canvas = useWorkspace((state) => state.canvas);
  const directory = useWorkspace((state) => state.workspace.directory);
  const [mailAddress, setMailAddress] = useState<string | null>(null);
  const [trashRetention, setTrashRetention] = useState<MailTrashRetention | null>(null);
  const [retentionError, setRetentionError] = useState<string | null>(null);
  const [timetableConnected, setTimetableConnected] = useState(false);
  const [dialog, setDialog] = useState<'canvas' | null>(null);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dela = window.dela;
    if (!dela) return undefined;
    let active = true;
    void Promise.all([dela.mail.getState(), dela.timetable.getState()]).then(
      ([mailState, timetableState]) => {
        if (!active) return;
        setMailAddress(mailState.account?.address ?? null);
        setTimetableConnected(timetableState.connected);
        if (mailState.account) {
          void dela.mail
            .getTrashRetention()
            .then((value) => {
              if (active) setTrashRetention(value);
            })
            .catch(() => {});
        }
      },
    );
    return () => {
      active = false;
    };
  }, []);

  const openDialog = () => {
    setDialog('canvas');
    setKey('');
    setError(null);
  };

  const configure = async () => {
    if (!window.dela || dialog !== 'canvas') return;
    setBusy(true);
    setError(null);
    try {
      await window.dela.canvas.configure(key);
      useWorkspace.getState().setCanvas(await window.dela.canvas.syncCourses());
      setDialog(null);
      setKey('');
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  const disconnectCanvas = async () => {
    if (!window.dela) return;
    setBusy(true);
    setError(null);
    try {
      await window.dela.canvas.disconnect();
      useWorkspace.getState().setCanvas(await window.dela.canvas.getState());
      setDialog(null);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  const chooseDirectory = () => {
    void window.dela?.workspace
      .chooseDirectory()
      .then(() => useWorkspace.getState().refresh())
      .catch(useWorkspace.getState().setError);
  };

  const changeRetention = async (value: MailTrashRetention) => {
    if (!window.dela || trashRetention === null) return;
    const previous = trashRetention;
    setTrashRetention(value);
    setRetentionError(null);
    try {
      setTrashRetention(await window.dela.mail.setTrashRetention(value));
    } catch (cause) {
      setTrashRetention(previous);
      setRetentionError(errorText(cause));
    }
  };

  const connections: Connection[] = [
    {
      name: 'Canvas',
      icon: GraduationCap,
      state: canvas.connected ? '已连接' : '未连接',
      connected: canvas.connected,
      description: '连接课程、作业与文件',
      actionLabel: canvas.connected ? '管理' : '配置',
      onClick: openDialog,
    },
    {
      name: '学校邮箱',
      icon: Mail,
      state: mailAddress ? `已连接 · ${mailAddress}` : '未配置',
      connected: Boolean(mailAddress),
      description: '通过 IMAP 读取交大邮箱',
      actionLabel: '前往',
      onClick: onOpenMail,
      // 仅在邮箱已连接且保留期已读取时显示;浏览器预览无 window.dela,自然不渲染。
      extra:
        trashRetention === null ? undefined : (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground max-md:hidden">已删除保留</span>
            <select
              aria-label="已删除邮件保留"
              className="h-8 rounded-md border bg-background px-1.5 text-xs text-foreground"
              onChange={(event) =>
                void changeRetention(Number(event.target.value) as MailTrashRetention)
              }
              value={trashRetention}
            >
              <option value={7}>7 天</option>
              <option value={30}>30 天</option>
              <option value={90}>90 天</option>
              <option value={0}>永久</option>
            </select>
            {retentionError && (
              <span className="text-xs text-destructive" role="alert">
                {retentionError}
              </span>
            )}
          </div>
        ),
    },
    {
      name: '教学信息服务网',
      icon: CalendarDays,
      state: timetableConnected ? '已连接' : '未连接',
      connected: timetableConnected,
      description: '同步个人课表与教学安排',
      actionLabel: '前往',
      onClick: onOpenTimetable,
    },
    {
      name: '工作目录',
      icon: Folder,
      state: directory ? '已设置' : '未选择',
      connected: Boolean(directory),
      description: directory || '保存笔记与生成文件',
      actionLabel: '选择',
      onClick: chooseDirectory,
    },
  ];

  return (
    <div className="grid gap-5">
      <SectionHeader description="凭据经系统加密保存在本机。" title="数据与服务" />
      <ul className="grid">
        {connections.map(
          ({ name, icon: Icon, state, connected, description, actionLabel, onClick, extra }) => (
            <li
              className="flex min-h-16 items-center justify-between gap-4 border-b last:border-0 max-md:items-start max-md:py-3"
              key={name}
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-secondary">
                  <Icon className="size-4 text-muted-foreground" strokeWidth={1.8} />
                </span>
                <div className="grid gap-0.5">
                  <strong className="text-sm">{name}</strong>
                  <span className="text-xs text-muted-foreground">{description}</span>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {extra}
                <span
                  className={cn(
                    'min-w-[72px] text-xs max-md:min-w-0',
                    connected ? 'text-foreground' : 'text-muted-foreground',
                  )}
                >
                  {state}
                </span>
                <Button onClick={onClick} size="sm" variant="secondary">
                  {actionLabel}
                </Button>
              </div>
            </li>
          ),
        )}
      </ul>
      <Dialog.Root
        onOpenChange={(open) => {
          if (!open && !busy) setDialog(null);
        }}
        open={dialog !== null}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/30 data-[state=open]:animate-in data-[state=open]:fade-in duration-150" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-background p-6 shadow-xl max-md:w-[calc(100%-2rem)]">
            <Dialog.Title className="text-base font-semibold">配置 Canvas</Dialog.Title>
            <Dialog.Description className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {canvas.connected
                ? '输入新的个人 Access Token 以替换当前连接，或断开并删除当前凭据。'
                : '输入个人 Access Token。验证成功后会读取课程列表，凭据仅由主进程加密保存。'}
            </Dialog.Description>
            <form
              className="mt-4 grid gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                void configure();
              }}
            >
              <label className="grid gap-2 text-sm">
                Access Token
                <Input
                  autoComplete="off"
                  autoFocus
                  onChange={(event) => setKey(event.target.value)}
                  required
                  type="password"
                  value={key}
                />
              </label>
              {error && (
                <p className="text-xs text-destructive" role="alert">
                  {error}
                </p>
              )}
              <div className="flex items-center justify-end gap-2">
                {canvas.connected && (
                  <Button disabled={busy} onClick={() => void disconnectCanvas()} variant="ghost">
                    断开
                  </Button>
                )}
                <Button disabled={busy} onClick={() => setDialog(null)} variant="ghost">
                  取消
                </Button>
                <Button disabled={busy} type="submit">
                  {busy ? '处理中…' : '保存并连接'}
                </Button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
