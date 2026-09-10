import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { Button } from '../../components/Button';
import { PageHeader } from '../../components/PageHeader';
import styles from './SettingsView.module.css';

type SettingsViewProps = { onOpenMail: () => void };

export function SettingsView({ onOpenMail }: SettingsViewProps) {
  const [mailAddress, setMailAddress] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void window.dela.mail.getState().then((state) => {
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
    <div className={clsx('page', styles.settingsPage)}>
      <PageHeader eyebrow="Dela" title="设置" />
      <section className={styles.settingsCard}>
        <div className={styles.settingsHeading}>
          <p className="eyebrow">连接</p>
          <h2>数据与服务</h2>
          <p>凭据保存在本机，不会暴露给页面。</p>
        </div>
        <div className={styles.connectionList}>
          {connections.map(({ name, state, description, onOpen }) => (
            <div className={styles.connectionRow} key={name}>
              <div>
                <strong>{name}</strong>
                <span>{description}</span>
              </div>
              <div>
                <span className={styles.connectionState}>{state}</span>
                {onOpen ? (
                  <Button onClick={onOpen} variant="quiet">
                    配置
                  </Button>
                ) : (
                  <Button variant="quiet">配置</Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>
      <section className={styles.settingsCard}>
        <div className={styles.settingsHeading}>
          <p className="eyebrow">外观</p>
          <h2>跟随系统</h2>
        </div>
        <div className={styles.themePreviewRow}>
          <button className={clsx(styles.themePreview, styles.isSelected)} type="button">
            <span />
            <strong>系统</strong>
          </button>
          <button className={clsx(styles.themePreview, styles.darkPreview)} type="button">
            <span />
            <strong>深色</strong>
          </button>
        </div>
      </section>
      <p className={styles.versionLine}>Dela {window.dela.version} · 本地优先的项目工作台</p>
    </div>
  );
}
