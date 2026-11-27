// 邮箱服务器参数的唯一读取口：IMAP 连接与发信共用，连接时写入账号行。
import type { MailServerConfig } from '../contract';
import { hostPorts } from '../../../core/ports';

interface ServerRow {
  imap_host: string;
  imap_port: number;
  smtp_host: string;
  smtp_port: number;
}

export function storedMailServer(): MailServerConfig {
  const row = hostPorts()
    .database()
    .prepare('SELECT imap_host, imap_port, smtp_host, smtp_port FROM mail_accounts LIMIT 1')
    .get() as ServerRow | undefined;
  if (!row) throw new Error('邮箱未连接');
  return {
    imapHost: row.imap_host,
    imapPort: row.imap_port,
    smtpHost: row.smtp_host,
    smtpPort: row.smtp_port,
  };
}
