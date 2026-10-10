// 设置搜索索引：全局搜索 setting 目标与关键词路由（设置页内搜索已随全局搜索统一移除）。
import { describe, expect, it } from 'vitest';
import { settingsResultsFor } from './search-index';

describe('settingsResultsFor (global search)', () => {
  it('targets the current section set and matches keywords', () => {
    const results = settingsResultsFor('邮件');
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      kind: 'setting',
      id: 'connections',
      target: { page: 'settings', section: 'connections' },
    });
  });
});
