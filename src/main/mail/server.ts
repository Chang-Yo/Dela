// 邮箱服务器参数的唯一读取口：IMAP 连接（api.ts）与发信（send.ts）都从这里取，
// 避免两边各存一份「交大预设」而漏掉第三方账号。列或值缺失一律回落交大预设，
// 老库（没有 smtp_host/smtp_port 列）与交大账号都走这条回落。
import type { MailServerConfig } from '../../shared/mail';
import { SJTU_MAIL_SERVER } from '../../shared/mail';
import { getDatabase } from '../database';

interface ServerRow {
  imap_host: string | null;
  imap_port: number | null;
  smtp_host: string | null;
  smtp_port: number | null;
}

export function storedMailServer(): MailServerConfig {
  const row = getDatabase()
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
