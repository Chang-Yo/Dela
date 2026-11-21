import type { Schema } from '../../../core/ports';

// 用户把帖子添加到项目时写入一行；快照正文与图片存在 userData/shuiyuan-snapshots。
export const shuiyuanSchema: Schema = {
  tables: [
    `CREATE TABLE IF NOT EXISTS shuiyuan_topics (
      topic_id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      excerpt TEXT,
      category_name TEXT,
      author TEXT,
      posts_count INTEGER,
      added_at TEXT NOT NULL,
      snapshot_status TEXT CHECK(snapshot_status IN ('saving', 'done', 'failed')),
      snapshot_at TEXT,
      snapshot_error TEXT
    )`,
  ],
};
