import type Database from 'better-sqlite3';

/** 早期交大账号没存 SMTP 参数，邮件模块靠内置的交大服务器兜底；写进账号行后邮件模块不再认识交大。 */
export function v13tov14(db: Database.Database): void {
  db.exec(`UPDATE mail_accounts SET
    smtp_host = COALESCE(NULLIF(smtp_host, ''), 'mail.sjtu.edu.cn'),
    smtp_port = COALESCE(smtp_port, 465)`);
}
