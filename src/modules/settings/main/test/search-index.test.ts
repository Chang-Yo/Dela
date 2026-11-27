import { expect, it } from 'vitest';
import { registerSettingsSearch, settingsSectionsMatching } from '../search-index';

it('matches the section of a registered item by its keyword', () => {
  expect(settingsSectionsMatching('registry-probe')).toEqual([]);
  registerSettingsSearch({
    id: 'probe',
    section: 'connections',
    title: 'Probe',
    keywords: ['registry-probe'],
  });
  expect(settingsSectionsMatching('registry-probe')).toEqual(['connections']);
});
