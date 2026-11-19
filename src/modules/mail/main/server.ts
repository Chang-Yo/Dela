// 邮箱服务器参数的唯一读取口：IMAP 连接与发信共用，避免各存一份「交大预设」。
// 列或值缺失（老库没有 smtp_host/smtp_port 列、交大账号）一律回落交大预设。
import { SJTU_MAIL_SERVER, type MailServerConfig } from '../contract';
import { hostPorts } from '../../../core/ports';

interface ServerRow {
  imap_host: string | null;
  imap_port: number | null;
  smtp_host: string | null;
  smtp_port: number | null;
}

export function storedMailServer(): MailServerConfig {
  const row = hostPorts()
    .database()
    .prepare('SELECT imap_host, imap_port, smtp_host, smtp_port FROM mail_accounts LIMIT 1')
    .get() as ServerRow | undefined;
  if (!row) return { ...SJTU_MAIL_SERVER };
  return {
    imapHost: row.imap_host || SJTU_MAIL_SERVER.imapHost,
    imapPort: row.imap_port ?? SJTU_MAIL_SERVER.imapPort,
    smtpHost: row.smtp_host || SJTU_MAIL_SERVER.smtpHost,
    smtpPort: row.smtp_port ?? SJTU_MAIL_SERVER.smtpPort,
  };
}
