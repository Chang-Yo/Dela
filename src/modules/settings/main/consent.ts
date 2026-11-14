import { app } from 'electron';
import { getDatabase } from '../../../main/database';
import type { ConsentDocument } from '../contract';

/** 条款接受记录只追加：条款改版、用户再次同意时写新行，不改写历史。 */
export function recordConsent(document: ConsentDocument, revision: string): void {
  try {
    getDatabase()
      .prepare(
        `INSERT INTO consent_records (document, revision, app_version, accepted_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(document, revision, app.getVersion(), new Date().toISOString());
  } catch (error) {
    // 留证失败不该拦住用户往下走（界面只关心同意与否），但也不能一声不响：日志在开发者能看的地方。
    console.error('条款接受记录写入失败', error);
  }
}
