import type Database from 'better-sqlite3';

export interface MigrationContext {
  userData: string;
  /** ~/.dela 所在的用户主目录。 */
  home: string;
  /** 系统钥匙串加解密（Electron safeStorage）；测试里换成明文。 */
  seal: { encrypt(text: string): Buffer; decrypt(data: Buffer): string };
}

export interface Migration {
  from: number;
  run(db: Database.Database, context: MigrationContext): void;
}
