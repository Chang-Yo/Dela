import { useEffect, useState } from 'react';
import { Dialog } from 'radix-ui';
import { Bot, CalendarDays, Folder, GraduationCap, Mail, type LucideIcon } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { cn } from '../../lib/utils';
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
};

export function ConnectionsSection({ onOpenMail, onOpenTimetable }: ConnectionsSectionProps) {
  const canvas = useWorkspace((state) => state.canvas);
  const directory = useWorkspace((state) => state.workspace.directory);
  const [mailAddress, setMailAddress] = useState<string | null>(null);
  const [timetableConnected, setTimetableConnected] = useState(false);
  const [modelConfigured, setModelConfigured] = useState(false);
  const [dialog, setDialog] = useState<'canvas' | 'model' | null>(null);
  const [key, setKey] = useState('');
  const [model, setModel] = useState('qwen');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dela = window.dela;
    if (!dela) return undefined;
    let active = true;
    void dela.workspace
      .getChat('sources')
      .then((chat) => {
        if (active) setModelConfigured(chat.configured);
      })
      .catch(() => {});
    void Promise.all([dela.mail.getState(), dela.timetable.getState()]).then(
      ([mailState, timetableState]) => {
        if (!active) return;
        setMailAddress(mailState.account?.address ?? null);
        setTimetableConnected(timetableState.connected);
      },
    );
    return () => {
      active = false;
    };
  }, []);

  const openDialog = (next: 'canvas' | 'model') => {
    setDialog(next);
    setKey('');
    setError(null);
    if (next === 'model') {
      void window.dela?.workspace.getChat('sources').then((chat) => setModel(chat.model));
    }
  };

  const configure = async () => {
    if (!window.dela || !dialog) return;
    setBusy(true);
    setError(null);
    try {
      if (dialog === 'canvas') {
        await window.dela.canvas.configure(key);
        useWorkspace.getState().setCanvas(await window.dela.canvas.syncCourses());
      } else {
        await window.dela.workspace.configureModel(key, model);
        setModelConfigured((await window.dela.workspace.getChat('sources')).configured);
      }
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

  const connections: Connection[] = [
    {
      name: 'Canvas',
      icon: GraduationCap,
      state: canvas.connected ? '已连接' : '未连接',
      connected: canvas.connected,
      description: '连接课程、作业与文件',
      actionLabel: canvas.connected ? '管理' : '配置',
      onClick: () => openDialog('canvas'),
    },
    {
      name: '学校邮箱',
      icon: Mail,
      state: mailAddress ? `已连接 · ${mailAddress}` : '未配置',
      connected: Boolean(mailAddress),
      description: '通过 IMAP 读取交大邮箱',
      actionLabel: '前往',
      onClick: onOpenMail,
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
      name: '致远一号',
      icon: Bot,
      state: modelConfigured ? '已配置' : '未配置',
      connected: modelConfigured,
      description: '用于资料与项目的正文问答',
      actionLabel: '配置',
      onClick: () => openDialog('model'),
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
      <section className="overflow-hidden rounded-xl border bg-card">
        <ul className="grid">
          {connections.map(
            ({ name, icon: Icon, state, connected, description, actionLabel, onClick }) => (
              <li
                className="flex min-h-16 items-center justify-between gap-4 border-b px-4 last:border-0 max-md:items-start max-md:py-3 md:px-5"
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
      </section>
      <Dialog.Root
        onOpenChange={(open) => {
          if (!open && !busy) setDialog(null);
        }}
        open={dialog !== null}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/30 data-[state=open]:animate-in data-[state=open]:fade-in duration-150" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-background p-6 shadow-xl max-md:w-[calc(100%-2rem)]">
            <Dialog.Title className="text-base font-semibold">
              {dialog === 'canvas' ? '配置 Canvas' : '配置致远一号'}
            </Dialog.Title>
            <Dialog.Description className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {dialog === 'canvas'
                ? canvas.connected
                  ? '输入新的个人 Access Token 以替换当前连接，或断开并删除当前凭据。'
                  : '输入个人 Access Token。验证成功后会读取课程列表，凭据仅由主进程加密保存。'
                : '选择模型并输入 API Key。密钥只会发送给致远一号，不会保存到页面。'}
            </Dialog.Description>
            <form
              className="mt-4 grid gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                void configure();
              }}
            >
              <label className="grid gap-2 text-sm">
                {dialog === 'canvas' ? 'Access Token' : 'API Key'}
                <Input
                  autoComplete="off"
                  autoFocus
                  onChange={(event) => setKey(event.target.value)}
                  required
                  type="password"
                  value={key}
                />
              </label>
              {dialog === 'model' && (
                <label className="grid gap-2 text-sm">
                  模型
                  <select
                    className="h-9 rounded-md border bg-background px-2 text-sm"
                    onChange={(event) => setModel(event.target.value)}
                    value={model}
                  >
                    <option value="qwen">Qwen</option>
                    <option value="deepseek-chat">DeepSeek</option>
                    <option value="deepseek-reasoner">DeepSeek · 深度思考</option>
                    <option value="minimax">MiniMax</option>
                  </select>
                </label>
              )}
              {error && (
                <p className="text-xs text-destructive" role="alert">
                  {error}
                </p>
              )}
              <div className="flex items-center justify-end gap-2">
                {dialog === 'canvas' && canvas.connected && (
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
