import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/button';
import { PageHeader } from '../../components/PageHeader';

type SettingsViewProps = { onOpenMail: () => void };

export function SettingsView({ onOpenMail }: SettingsViewProps) {
  const [mailAddress, setMailAddress] = useState<string | null>(null);

  useEffect(() => {
    const mail = window.dela?.mail;
    if (!mail) return undefined;
    let active = true;
    void mail.getState().then((state) => {
      if (active) setMailAddress(state.account?.address ?? null);
    });
    return () => {
      active = false;
    };
  }, []);

  const connections = [
    { name: 'Canvas', state: '未连接', description: '连接课程、作业与文件', onOpen: undefined },
    {
      name: '学校邮箱',
      state: mailAddress ? `已连接 · ${mailAddress}` : '未配置',
      description: '通过 IMAP 读取交大邮箱',
      onOpen: onOpenMail,
    },
    { name: '致远一号', state: '未配置', description: '用于项目内 Agent 请求', onOpen: undefined },
    { name: '工作目录', state: '未选择', description: '保存笔记与生成文件', onOpen: undefined },
  ];

  return (
    <div className="page max-w-[980px]">
      <PageHeader eyebrow="Dela" title="设置" />
      <section className="mt-8 grid grid-cols-[210px_minmax(0,1fr)] gap-6 rounded-xl border bg-card p-5 max-md:grid-cols-1 max-md:gap-4 max-md:p-4">
        <div className="grid content-start gap-2">
          <p className="text-[11px] font-medium text-muted-foreground">连接</p>
          <h2 className="text-base font-semibold tracking-tight">数据与服务</h2>
          <p className="text-xs leading-relaxed text-muted-foreground">
            凭据保存在本机，不会暴露给页面。
          </p>
        </div>
        <div className="grid">
          {connections.map(({ name, state, description, onOpen }) => (
            <div
              className="flex min-h-16 items-center justify-between gap-4 border-b last:border-0 max-md:items-start max-md:py-3"
              key={name}
            >
              <div className="grid gap-0.5">
                <strong className="text-sm">{name}</strong>
                <span className="text-xs text-muted-foreground">{description}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="min-w-[72px] text-xs text-muted-foreground max-md:min-w-0">
                  {state}
                </span>
                <Button onClick={onOpen} size="sm" variant="secondary">
                  配置
                </Button>
              </div>
            </div>
          ))}
        </div>
      </section>
      <section className="mt-6 grid grid-cols-[210px_minmax(0,1fr)] gap-6 rounded-xl border bg-card p-5 max-md:grid-cols-1 max-md:gap-4 max-md:p-4">
        <div className="grid content-start gap-2">
          <p className="text-[11px] font-medium text-muted-foreground">外观</p>
          <h2 className="text-base font-semibold tracking-tight">跟随系统</h2>
        </div>
        <div className="flex flex-wrap gap-4">
          <button
            className="grid w-[130px] gap-2 rounded-lg border bg-transparent p-2 text-left transition-colors hover:bg-muted/50 [&>span]:h-16 [&>span]:rounded [&>span]:bg-linear-to-r [&>span]:from-secondary [&>span]:from-30% [&>span]:to-background"
            type="button"
          >
            <span />
            <strong className="text-xs">系统</strong>
          </button>
          <button
            className="grid w-[130px] gap-2 rounded-lg border bg-transparent p-2 text-left transition-colors hover:bg-muted/50 [&>span]:h-16 [&>span]:rounded [&>span]:bg-neutral-800"
            type="button"
          >
            <span />
            <strong className="text-xs">深色</strong>
          </button>
        </div>
      </section>
      <p className="mt-5 text-center text-xs text-muted-foreground">
        Dela {window.dela?.version ?? '浏览器预览'} · 本地优先的项目工作台
      </p>
    </div>
  );
}
