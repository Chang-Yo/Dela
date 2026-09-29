// 设置搜索索引：关键词过滤（同义/英文）、全局搜索 setting 目标与索引完整性。
import { describe, expect, it } from 'vitest';
import type { SettingsSectionId } from '../../../shared/settings';
import {
  filterSettingsItems,
  settingsResultsFor,
  settingsSearchItems,
  settingsSectionLabels,
} from './search-index';

const sectionIds = Object.keys(settingsSectionLabels) as SettingsSectionId[];

describe('settings search index integrity', () => {
  it('covers all eight sections with unique item ids', () => {
    expect(sectionIds).toEqual([
      'general',
      'appearance',
      'notifications',
      'workspace',
      'llm',
      'connections',
      'plugins',
      'about',
    ]);
    const ids = settingsSearchItems.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const item of settingsSearchItems) {
      expect(sectionIds).toContain(item.section);
    }
  });
});

describe('filterSettingsItems', () => {
  it('matches by title', () => {
    expect(filterSettingsItems('开机自启动').map((item) => item.id)).toEqual(['open-at-login']);
  });

  it('maps synonyms to the right section (主题→外观, API→模型服务, 邮件→连接)', () => {
    expect(filterSettingsItems('主题')[0]!.section).toBe('appearance');
    expect(filterSettingsItems('API')[0]!.section).toBe('llm');
    expect(filterSettingsItems('邮件')[0]!.section).toBe('connections');
  });

  it('matches by section label and english keywords', () => {
    expect(filterSettingsItems('通知')[0]!.section).toBe('notifications');
    expect(filterSettingsItems('canvas')[0]!.section).toBe('connections');
    expect(filterSettingsItems('zoom')[0]!.section).toBe('appearance');
  });

  it('returns every item for an empty query and nothing for gibberish', () => {
    expect(filterSettingsItems('')).toHaveLength(settingsSearchItems.length);
    expect(filterSettingsItems('zzz不存在的选项')).toEqual([]);
  });
});

describe('settingsResultsFor (global search)', () => {
  it('targets the new section set and matches keywords', () => {
    const results = settingsResultsFor('邮件');
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      kind: 'setting',
      id: 'connections',
      target: { page: 'settings', section: 'connections' },
    });
  });

  it('maps model/API queries to the llm section', () => {
    const api = settingsResultsFor('api')[0];
    const model = settingsResultsFor('模型')[0];
    expect(api?.kind).toBe('setting');
    expect(model?.kind).toBe('setting');
    expect(api?.kind === 'setting' && api.target.section).toBe('llm');
    expect(model?.kind === 'setting' && model.target.section).toBe('llm');
  });

  it('returns all eight sections for an empty query', () => {
    expect(settingsResultsFor('')).toHaveLength(8);
  });
});
