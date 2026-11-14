import { useEffect, useState, type ReactNode } from 'react';
import { GraduationCap, Mail, type LucideIcon } from 'lucide-react';
import { Button } from '../../../../ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../../ui/select';
import type { MailTrashRetention } from '../../../../shared/api';
import { CanvasTokenForm } from './CanvasTokenForm';
import { SectionHeader } from '../SectionHeader';
import { SettingsGroup } from '../SettingsGroup';
import { errorText, useWorkspaceStore } from '../../../workspace/store';
import { showToast } from '../../../app/toasts';
import { ErrorText } from '../../../../ui/alert';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '../../../../ui/dialog';
import { CredentialRow } from '../../../../modules/settings/view';
import { views } from '../../../../app/views';
import { useNavigationStore } from '../../../navigation/view';

type ConnectionsSectionProps = {
  onOpenMail: () => void;
};

type Connection = {
  /** 搜索直达与高亮目标（data-setting-id）。 */
  itemId: string;
  name: string;
  icon: LucideIcon;
  state: string;
  connected: boolean;
  /** 防误解的关键说明（如授权范围）；其余连接不显示描述。 */
  description?: string;
  actionLabel: string;
  onClick: () => void;
  /** 条目右侧的内联设置(如保留期);仅在相应数据就绪时渲染。 */
  extra?: ReactNode;
};

/** 设置 › 凭据：未迁移的连接写在这里，模块的凭据行由视图定义登记。 */
export function ConnectionsSection({ onOpenMail }: ConnectionsSectionProps) {
  const canvas = useWorkspaceStore((state) => state.canvas);
  const [mailAddress, setMailAddress] = useState<string | null>(null);
  const [trashRetention, setTrashRetention] = useState<MailTrashRetention | null>(null);
  const [dialog, setDialog] = useState<'canvas' | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const dela = window.dela;
    if (!dela) return undefined;
    let active = true;
    void dela.mail
      .getState()
      .then((mailState) => {
        if (!active) return;
        setMailAddress(mailState.account?.address ?? null);
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
  ];

  return (
    <div className="grid gap-10">
      <SectionHeader title="凭据" />
      {loadError && <ErrorText>{loadError}</ErrorText>}
      <SettingsGroup>
        <ul className="grid">
          {connections.map(
            ({
              itemId,
              name,
              icon,
              state,
              connected,
              description,
              actionLabel,
              onClick,
              extra,
            }) => (
              <CredentialRow
                connected={connected}
                description={description}
                icon={icon}
                key={itemId}
                name={name}
                settingId={itemId}
                status={state}
              >
                {extra}
                <Button className="shrink-0" onClick={onClick} size="sm" variant="secondary">
                  {actionLabel}
                </Button>
              </CredentialRow>
            ),
          )}
          {views.map(({ settings }, index) => {
            const Credential = settings?.credentials;
            return (
              Credential && (
                <Credential key={index} navigate={useNavigationStore.getState().navigate} />
              )
            );
          })}
        </ul>
      </SettingsGroup>
      <Dialog
        onOpenChange={(open) => {
          if (!open && !busy) setDialog(null);
        }}
        open={dialog !== null}
      >
        <DialogContent scroll>
          <DialogTitle>配置 Canvas</DialogTitle>
          <DialogDescription>
            {canvas.connected
              ? '输入新的个人 Access Token 以替换当前连接。'
              : '输入个人 Access Token，验证成功后读取课程列表；凭据加密保存在本机。'}
          </DialogDescription>
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
        </DialogContent>
      </Dialog>
    </div>
  );
}
