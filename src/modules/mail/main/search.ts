import { likePattern, type SearchProvider } from '../../modules/search';
import { getDatabase } from '../database';

const matchedColumns = ['subject', 'sender_name', 'sender_address', 'snippet', 'body_text'];

export const mailSearch: SearchProvider = {
  id: 'mail',
  label: '邮件',
  icon: 'mail',
  search(query, limit) {
    const match = matchedColumns.map((column) => `${column} LIKE ? ESCAPE '!'`).join(' OR ');
    const rows = getDatabase()
      .prepare(
        `SELECT id, subject, sender_name AS senderName, sender_address AS senderAddress, snippet
         FROM mail_messages WHERE deleted_at IS NULL ${query ? `AND (${match})` : ''}
         ORDER BY date DESC LIMIT ?`,
      )
      .all(...(query ? matchedColumns.map(() => likePattern(query)) : []), limit) as {
      id: number;
      subject: string | null;
      senderName: string | null;
      senderAddress: string | null;
      snippet: string | null;
    }[];
    return rows.map((row) => ({
      id: String(row.id),
      title: row.subject || '(无主题)',
      subtitle: row.senderName || row.senderAddress || row.snippet,
      target: { page: 'mail', messageId: row.id },
    }));
  },
};
