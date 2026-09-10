import { useState } from 'react';
import { Button } from '../../components/Button';
import styles from './MailView.module.css';
type ConfigureFormProps = {
  onSubmit: (address: string, password: string) => Promise<void>;
  error: string | null;
  busy: boolean;
};

export function ConfigureForm({ onSubmit, error, busy }: ConfigureFormProps) {
  const [address, setAddress] = useState('');
  const [password, setPassword] = useState('');

  return (
    <div className={styles.configWrap}>
      <form
        className={styles.configCard}
        onSubmit={(event) => {
          event.preventDefault();
          void onSubmit(address, password);
        }}
      >
        <p className="eyebrow">内置邮箱</p>
        <h2>连接交大邮箱</h2>
        <p className={styles.configCopy}>
          使用 jAccount 账号对应的邮箱和密码登录。凭据加密保存在本机，不会发送到其他服务。
        </p>
        <label className={styles.fieldLabel}>
          邮箱地址
          <input
            autoComplete="off"
            className={styles.textInput}
            onChange={(event) => setAddress(event.target.value)}
            placeholder="name@sjtu.edu.cn"
            required
            type="email"
            value={address}
          />
        </label>
        <label className={styles.fieldLabel}>
          密码
          <input
            autoComplete="current-password"
            className={styles.textInput}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="jAccount 密码"
            required
            type="password"
            value={password}
          />
        </label>
        {error && <p className={styles.configError}>{error}</p>}
        <Button disabled={busy} type="submit" variant="primary">
          {busy ? '正在验证…' : '连接并同步'}
        </Button>
        <p className={styles.configHint}>服务器 mail.sjtu.edu.cn · IMAPS 993</p>
      </form>
    </div>
  );
}
