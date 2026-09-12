import { useEffect, useState } from 'react';
import { Bot, CalendarDays, Folder, GraduationCap, Mail, type LucideIcon } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { cn } from '../../lib/utils';
import { SectionHeader } from './SectionHeader';
import { useWorkspace } from '../projects/workspace';

type ConnectionsSectionProps = {
  onOpenMail: () => void;
  onOpenTimetable: () => void;
  onOpenSources: () => void;
};

type Connection = {
  name: string;
  icon: LucideIcon;
  state: string;
  connected: boolean;
  description: string;
  onOpen?: () => void;
};

export function ConnectionsSection({
  onOpenMail,
  onOpenTimetable,
  onOpenSources,
}: ConnectionsSectionProps) {
  const canvas = useWorkspace((state) => state.canvas);
  const directory = useWorkspace((state) => state.workspace.directory);
  const [mailAddress, setMailAddress] = useState<string | null>(null);
  const [timetableConnected, setTimetableConnected] = useState(false);
  const [modelConfigured, setModelConfigured] = useState(false);

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

  const connections: Connection[] = [
    {
      name: 'Canvas',
      icon: GraduationCap,
      state: canvas.connected ? '已连接' : '未连接',
      connected: canvas.connected,
      description: '连接课程、作业与文件',
      onOpen: onOpenSources,
    },
    {
      name: '学校邮箱',
      icon: Mail,
      state: mailAddress ? `已连接 · ${mailAddress}` : '未配置',
      connected: Boolean(mailAddress),
      description: '通过 IMAP 读取交大邮箱',
      onOpen: onOpenMail,
    },
    {
      name: '教学信息服务网',
      icon: CalendarDays,
      state: timetableConnected ? '已连接' : '未连接',
      connected: timetableConnected,
      description: '同步个人课表与教学安排',
      onOpen: onOpenTimetable,
    },
    {
      name: '致远一号',
      icon: Bot,
      state: modelConfigured ? '已配置' : '未配置',
      connected: modelConfigured,
      description: '在资料或项目的助手面板配置正文问答',
      onOpen: onOpenSources,
    },
    {
      name: '工作目录',
      icon: Folder,
      state: directory ? '已设置' : '未选择',
      connected: Boolean(directory),
      description: directory || '保存笔记与生成文件',
      onOpen: () => {
        void window.dela?.workspace
          .chooseDirectory()
          .then(() => useWorkspace.getState().refresh())
          .catch(useWorkspace.getState().setError);
      },
    },
  ];

  return (
    <div className="grid gap-5">
      <SectionHeader description="凭据保存在本机，不会暴露给页面。" title="数据与服务" />
      <section className="overflow-hidden rounded-xl border bg-card">
        <ul className="grid">
          {connections.map(({ name, icon: Icon, state, connected, description, onOpen }) => (
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
                <Button disabled={!onOpen} onClick={onOpen} size="sm" variant="secondary">
                  配置
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
