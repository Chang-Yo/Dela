/** 「9月28日 18:22」样式的短日期；无值时回退「无截止日期」。 */
export function dateLabel(value: string | null) {
  return value
    ? new Date(value).toLocaleString('zh-CN', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '无截止日期';
}
