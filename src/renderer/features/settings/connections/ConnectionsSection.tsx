import { useEffect, useState, type ReactNode } from 'react';
import { Dialog } from 'radix-ui';
import { CalendarDays, GraduationCap, Mail, type LucideIcon } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { ShuiyuanIcon } from '../../../components/ui/shuiyuan-icon';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select';
import { cn } from '../../../lib/utils';
import type { MailTrashRetention } from '../../../../shared/api';
import { CanvasTokenForm } from './CanvasTokenForm';
import { SectionHeader } from '../SectionHeader';
import { SettingsGroup } from '../SettingsGroup';
import { errorText, useWorkspaceStore } from '../../../workspace/store';
import { showToast } from '../../../app/toasts';
import { dialogOverlay, dialogPanel } from '../../../components/ui/motion';

type ConnectionsSectionProps = {
  onOpenMail: () => void;
  onOpenShuiyuan: () => void;
  onOpenTimetable: () => void;
};

type Connection = {
  /** 搜索直达与高亮目标（data-setting-id）。 */
  itemId: string;
  name: string;
  icon: LucideIcon | typeof ShuiyuanIcon;
  state: string;
  connected: boolean;
  /** 防误解的关键说明（如授权范围）；其余连接不显示描述。 */
  description?: string;
  actionLabel: string;
  onClick: () => void;
  /** 条目右侧的内联设置(如保留期);仅在相应数据就绪时渲染。 */
  extra?: ReactNode;
};

/** 设置 › 连接：Canvas、邮箱、教务、水源四张连接卡的容器（工作目录已迁往「工作区」）。 */
export function ConnectionsSection({
  onOpenMail,
  onOpenShuiyuan,
  onOpenTimetable,
}: ConnectionsSectionProps) {
  const canvas = useWorkspaceStore((state) => state.canvas);
  const [mailAddress, setMailAddress] = useState<string | null>(null);
  const [trashRetention, setTrashRetention] = useState<MailTrashRetention | null>(null);
  const [timetableConnected, setTimetableConnected] = useState(false);
  const [shuiyuanUser, setShuiyuanUser] = useState<string | null>(null);
  const [shuiyuanBusy, setShuiyuanBusy] = useState(false);
  const [shuiyuanConfirm, setShuiyuanConfirm] = useState(false);
  const [dialog, setDialog] = useState<'canvas' | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const dela = window.dela;
    if (!dela) return undefined;
    let active = true;
    void Promise.all([dela.mail.getState(), dela.timetable.getState(), dela.shuiyuan.getState()])
      .then(([mailState, timetableState, shuiyuanState]) => {
        if (!active) return;
        setMailAddress(mailState.account?.address ?? null);
        setTimetableConnected(timetableState.connected);
        setShuiyuanUser(shuiyuanState.connected ? shuiyuanState.username : null);
        if (mailState.account) {
          void dela.mail
            .getTrashRetention()
            .then((value) => {
              if (active) setTrashRetention(value);
            })
            .catch(() => {});
        }
      })
      .catch((cause) => {
        if (active) setLoadError(errorText(cause));
      });
    return () => {
      active = false;
    };
  }, []);

  // 水源解绑：先远端 revoke 再清本地；两步确认防误触（重新授权成本高）。
  const unbindShuiyuan = async () => {
    if (!window.dela || !shuiyuanConfirm) {
      setShuiyuanConfirm(true);
      return;
    }
    setShuiyuanBusy(true);
    try {
      await window.dela.shuiyuan.unbind();
      setShuiyuanUser(null);
      setShuiyuanConfirm(false);
    } catch (cause) {
      showToast({ variant: 'error', title: '解除绑定失败', description: errorText(cause) });
    } finally {
      setShuiyuanBusy(false);
    }
  };

  const openDialog = () => {
    setDialog('canvas');
  };

  const disconnectCanvas = async () => {
    if (!window.dela) return;
    setBusy(true);
    try {
      await window.dela.canvas.disconnect();
      useWorkspaceStore.getState().setCanvas(await window.dela.canvas.getState());
      setDialog(null);
    } catch (cause) {
      showToast({ variant: 'error', title: '断开连接失败', description: errorText(cause) });
    } finally {
      setBusy(false);
    }
  };

  const changeRetention = async (value: MailTrashRetention) => {
    if (!window.dela || trashRetention === null) return;
    const previous = trashRetention;
    setTrashRetention(value);
    try {
      setTrashRetention(await window.dela.mail.setTrashRetention(value));
    } catch (cause) {
      setTrashRetention(previous);
      showToast({ variant: 'error', title: '保存保留期失败', description: errorText(cause) });
    }
  };

  const connections: Connection[] = [
    {
      itemId: 'canvas',
      name: 'Canvas',
      icon: GraduationCap,
      state: canvas.connected ? '已连接' : '未连接',
      connected: canvas.connected,
      actionLabel: canvas.connected ? '管理' : '配置',
      onClick: openDialog,
    },
    {
      itemId: 'mail',
      name: '学校邮箱',
      icon: Mail,
      state: mailAddress ? `已连接 · ${mailAddress}` : '未配置',
      connected: Boolean(mailAddress),
      actionLabel: '前往',
      onClick: onOpenMail,
      // 仅在邮箱已连接且保留期已读取时显示;浏览器预览无 window.dela,自然不渲染。
      extra:
        trashRetention === null ? undefined : (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-ink-3 max-md:hidden">已删除保留</span>
            <Select
              onValueChange={(value) => void changeRetention(Number(value) as MailTrashRetention)}
              value={String(trashRetention)}
            >
              <SelectTrigger aria-label="已删除邮件保留" className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">7 天</SelectItem>
                <SelectItem value="30">30 天</SelectItem>
                <SelectItem value="90">90 天</SelectItem>
                <SelectItem value="0">永久</SelectItem>
              </SelectContent>
            </Select>
          </div>
        ),
    },
    {
      itemId: 'timetable',
      name: '教学信息服务网',
      icon: CalendarDays,
      state: timetableConnected ? '已连接' : '未连接',
      connected: timetableConnected,
      actionLabel: '前往',
      onClick: onOpenTimetable,
    },
    {
      itemId: 'shuiyuan',
      name: '水源社区',
      icon: ShuiyuanIcon,
      state: shuiyuanUser ? `已绑定 · @${shuiyuanUser}` : '未绑定',
      connected: Boolean(shuiyuanUser),
      // 授权范围是绑定前的知情要件，保留。
      description: '读取与写入授权（浏览、回复、私信）',
      actionLabel: shuiyuanUser
        ? shuiyuanBusy
          ? '解除中…'
          : shuiyuanConfirm
            ? '确认解除？'
            : '解除绑定'
        : '去绑定',
      onClick: shuiyuanUser ? () => void unbindShuiyuan() : onOpenShuiyuan,
    },
  ];

  return (
    <div className="grid gap-10">
      <SectionHeader title="连接" />
      {loadError && (
        <p className="text-xs text-red" role="alert">
          {loadError}
        </p>
      )}
      <SettingsGroup>
        <ul className="grid">
          {connections.map(
            ({
              itemId,
              name,
              icon: Icon,
              state,
              connected,
              description,
              actionLabel,
              onClick,
              extra,
            }) => (
              <li
                className="flex items-center justify-between gap-4 border-b py-3 last:border-0 max-md:items-start"
                data-setting-id={itemId}
                key={name}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid size-8 shrink-0 place-items-center rounded-card bg-hover-2">
                    <Icon className="size-4 text-ink-3" strokeWidth={1.8} />
                  </span>
                  <div className="grid min-w-0 gap-0.5">
                    <strong className="text-13">{name}</strong>
                    {description && (
                      <span className="truncate text-xs text-ink-3" title={description}>
                        {description}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex min-w-0 items-center gap-2">
                  {extra}
                  {/* 状态用颜色说话：绿点=已连接，灰点=未连接；文字只补充细节。 */}
                  <span
                    className={cn(
                      'flex min-w-[4.5rem] max-w-40 items-center gap-1.5 text-xs max-md:min-w-0',
                      connected ? 'text-ink' : 'text-ink-3',
                    )}
                    title={state}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        'size-1.5 shrink-0 rounded-full',
                        connected ? 'bg-green' : 'bg-ink-3',
                      )}
                    />
                    <span className="truncate">{state}</span>
                  </span>
                  <Button className="shrink-0" onClick={onClick} size="sm" variant="secondary">
                    {actionLabel}
                  </Button>
                </div>
              </li>
            ),
          )}
        </ul>
      </SettingsGroup>
      <Dialog.Root
        onOpenChange={(open) => {
          if (!open && !busy) setDialog(null);
        }}
        open={dialog !== null}
      >
        <Dialog.Portal>
          <Dialog.Overlay className={dialogOverlay} />
          <Dialog.Content className={cn(dialogPanel, 'max-h-[85vh] max-w-md overflow-y-auto')}>
            <Dialog.Title className="text-base font-semibold">配置 Canvas</Dialog.Title>
            <Dialog.Description className="mt-2 text-xs leading-relaxed text-ink-3">
              {canvas.connected
                ? '输入新的个人 Access Token 以替换当前连接。'
                : '输入个人 Access Token，验证成功后读取课程列表；凭据加密保存在本机。'}
            </Dialog.Description>
            <CanvasTokenForm
              actions={
                <>
                  {canvas.connected && (
                    <Button disabled={busy} onClick={() => void disconnectCanvas()} variant="ghost">
                      断开
                    </Button>
                  )}
                  <Button disabled={busy} onClick={() => setDialog(null)} variant="ghost">
                    取消
                  </Button>
                </>
              }
              onSuccess={() => setDialog(null)}
            />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
