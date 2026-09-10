import clsx from 'clsx';
import { Button } from '../../components/Button';
import { PageHeader } from '../../components/PageHeader';
import styles from './SettingsView.module.css';

const connections = [
  { name: 'Canvas', state: '未连接', description: '连接课程、作业与文件' },
  { name: '学校邮箱', state: '需要登录', description: '通过个人邮箱协议读取' },
  { name: '致远一号', state: '未配置', description: '用于项目内 Agent 请求' },
  { name: '工作目录', state: '未选择', description: '保存笔记与生成文件' },
];

export function SettingsView() {
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
          {connections.map(({ name, state, description }) => (
            <div className={styles.connectionRow} key={name}>
              <div>
                <strong>{name}</strong>
                <span>{description}</span>
              </div>
              <div>
                <span className={styles.connectionState}>{state}</span>
                <Button variant="quiet">配置</Button>
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
