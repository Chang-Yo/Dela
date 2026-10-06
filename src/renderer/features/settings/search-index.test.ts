// 设置搜索索引：全局搜索 setting 目标与索引完整性（设置页内搜索已随全局搜索统一移除）。
import { describe, expect, it } from 'vitest';
import type { SettingsSectionId } from '../../../shared/settings';
import { settingsResultsFor, settingsSearchItems, settingsSectionLabels } from './search-index';

const sectionIds = Object.keys(settingsSectionLabels) as SettingsSectionId[];

describe('settings search index integrity', () => {
  it('covers all thirteen sections with unique item ids', () => {
    expect(sectionIds).toEqual([
      'general',
      'appearance',
      'shortcuts',
      'workspace',
      'archived',
      'connections',
      'providers',
      'capabilities',
      'commands',
      'skills',
      'mcp',
      'about',
      'privacy',
    ]);
    const ids = settingsSearchItems.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const item of settingsSearchItems) {
      expect(sectionIds).toContain(item.section);
    }
  });
});

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

  it('maps model/API queries to the provider section', () => {
    const api = settingsResultsFor('api')[0];
    const model = settingsResultsFor('模型')[0];
    expect(api?.kind).toBe('setting');
    expect(model?.kind).toBe('setting');
    expect(api?.kind === 'setting' && api.target.section).toBe('providers');
    expect(model?.kind === 'setting' && model.target.section).toBe('providers');
  });

  it('routes capability and shortcut queries to their own sections', () => {
    const capability = settingsResultsFor('能力')[0];
    const shortcut = settingsResultsFor('快捷键')[0];
    expect(capability?.kind === 'setting' && capability.target.section).toBe('capabilities');
    expect(shortcut?.kind === 'setting' && shortcut.target.section).toBe('shortcuts');
  });

  it('returns all thirteen sections for an empty query', () => {
    expect(settingsResultsFor('')).toHaveLength(13);
  });
});
