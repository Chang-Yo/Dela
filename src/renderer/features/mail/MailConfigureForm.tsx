import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';

type ConfigureFormProps = {
  onSubmit: (address: string, password: string) => Promise<void>;
  error: string | null;
  busy: boolean;
};

export function ConfigureForm({ onSubmit, error, busy }: ConfigureFormProps) {
  const [address, setAddress] = useState('');
  const [password, setPassword] = useState('');

  return (
    <div className="flex min-h-0 flex-1 overflow-y-auto p-6">
      <form
        className="m-auto grid w-full max-w-[400px] gap-4 rounded-2xl border bg-card p-8 shadow-sm"
        onSubmit={(event) => {
          event.preventDefault();
          void onSubmit(address, password);
        }}
      >
        <div className="grid gap-1.5">
          <h2 className="text-lg font-semibold tracking-tight">连接交大邮箱</h2>
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            使用 jAccount 账号对应的邮箱和密码登录。凭据加密保存在本机，不会发送到其他服务。
          </p>
        </div>
        <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
          邮箱地址
          <Input
            autoComplete="off"
            onChange={(event) => setAddress(event.target.value)}
            placeholder="name@sjtu.edu.cn"
            required
            type="email"
            value={address}
          />
        </label>
        <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
          密码
          <Input
            autoComplete="current-password"
            onChange={(event) => setPassword(event.target.value)}
            placeholder="jAccount 密码"
            required
            type="password"
            value={password}
          />
        </label>
        {error && (
          <p className="text-[13px] text-destructive" role="alert">
            {error}
          </p>
        )}
        <Button disabled={busy} type="submit">
          {busy ? '正在验证…' : '连接并同步'}
        </Button>
        <p className="text-center text-[11px] text-muted-foreground">
          服务器 mail.sjtu.edu.cn · IMAPS 993
        </p>
      </form>
    </div>
  );
}
