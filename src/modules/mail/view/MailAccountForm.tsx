import { useState, type ReactNode } from 'react';
import type { MailConfigureInput } from '../contract';
import { SegmentedControl } from '../../../ui/segmented-control';
import { Input } from '../../../ui/input';
import { cn } from '../../../ui/lib/cn';
import { Collapsible } from '../../../ui/collapsible';
import { ErrorText } from '../../../ui/error-text';
import { mailPresets } from './presets';

const OTHER = '其他邮箱';

/** 向导页与邮箱空态共用的连接表单：登记过的常用邮箱走预设，其他邮箱自填服务器参数。 */
export function MailAccountForm({
  error,
  onSubmit,
  submit,
  variant = 'app',
}: {
  error: string | null;
  onSubmit: (input: MailConfigureInput) => void;
  submit: ReactNode;
  variant?: 'app' | 'wizard';
}) {
  const presets = mailPresets();
  const modes = [...presets.map((preset) => preset.label), OTHER];
  const [mode, setMode] = useState(modes[0]!);
  const [address, setAddress] = useState('');
  const [password, setPassword] = useState('');
  const [imapHost, setImapHost] = useState('');
  const [imapPort, setImapPort] = useState('993');
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState('465');
  const [addressError, setAddressError] = useState<string | null>(null);
  const preset = presets.find((candidate) => candidate.label === mode);
  const wizard = variant === 'wizard';
  const field = wizard ? 'h-10 rounded-card' : '';
  const label = wizard ? 'text-sm font-medium text-ink-2' : 'text-xs font-medium text-ink-3';
  const shownError = addressError ?? error;

  return (
    <form
      className={wizard ? 'grid gap-5' : 'grid gap-4'}
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = address.trim();
        if (preset && !trimmed.toLowerCase().endsWith(`@${preset.domain}`)) {
          setAddressError(`${preset.label}地址需以 @${preset.domain} 结尾，或改选${OTHER}`);
          return;
        }
        setAddressError(null);
        onSubmit({
          address: trimmed,
          password,
          server: preset?.server ?? {
            imapHost: imapHost.trim(),
            imapPort: Number(imapPort),
            smtpHost: smtpHost.trim(),
            smtpPort: Number(smtpPort),
          },
        });
      }}
    >
      {presets.length > 0 && (
        <SegmentedControl className="w-full" onValueChange={setMode} options={modes} value={mode} />
      )}
      <label className="grid gap-2">
        <span className={label}>邮箱地址</span>
        <Input
          autoComplete="off"
          className={field}
          onChange={(event) => setAddress(event.target.value)}
          placeholder={preset ? `name@${preset.domain}` : 'name@example.com'}
          required
          type="email"
          value={address}
        />
      </label>
      <div>
        <label className="grid gap-2">
          <span className={label}>密码</span>
          <Input
            autoComplete="current-password"
            className={field}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={preset?.passwordHint ?? '邮箱密码或授权码'}
            required
            type="password"
            value={password}
          />
        </label>
        <Collapsible open={!preset}>
          <div className={cn('grid gap-4', wizard ? 'pt-5' : 'pt-4')}>
            <ServerRow
              field={field}
              host={imapHost}
              label={label}
              name="IMAP 服务器"
              onHost={setImapHost}
              onPort={setImapPort}
              placeholder="imap.example.com"
              port={imapPort}
            />
            <ServerRow
              field={field}
              host={smtpHost}
              label={label}
              name="SMTP 服务器"
              onHost={setSmtpHost}
              onPort={setSmtpPort}
              placeholder="smtp.example.com"
              port={smtpPort}
            />
            <p className="text-xs leading-relaxed text-ink-3">
              固定使用 SSL/TLS 加密；用户名即邮箱地址。发信走 SMTP，收信走 IMAP。
            </p>
          </div>
        </Collapsible>
      </div>
      {shownError && <ErrorText size="sm">{shownError}</ErrorText>}
      {submit}
    </form>
  );
}

function ServerRow({
  field,
  host,
  label,
  name,
  onHost,
  onPort,
  placeholder,
  port,
}: {
  field: string;
  host: string;
  label: string;
  name: string;
  onHost: (value: string) => void;
  onPort: (value: string) => void;
  placeholder: string;
  port: string;
}) {
  return (
    <div className="grid gap-2">
      <span className={label}>{name}</span>
      <div className="flex gap-2">
        <Input
          aria-label={`${name}地址`}
          autoComplete="off"
          className={cn('flex-1', field)}
          onChange={(event) => onHost(event.target.value)}
          placeholder={placeholder}
          required
          value={host}
        />
        <Input
          aria-label={`${name}端口`}
          className={cn('w-20', field)}
          inputMode="numeric"
          max={65535}
          min={1}
          onChange={(event) => onPort(event.target.value)}
          required
          type="number"
          value={port}
        />
      </div>
    </div>
  );
}
