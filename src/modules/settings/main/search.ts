import type { SearchProvider } from '../../search';
import { settingsSectionLabels } from '../contract';
import { settingsSectionsMatching, settingsSectionSummaries } from './search-index';

export const settingsSearch: SearchProvider = {
  id: 'setting',
  label: '设置',
  icon: 'settings',
  search(query, limit) {
    return settingsSectionsMatching(query)
      .slice(0, limit)
      .map((section) => ({
        id: section,
        title: settingsSectionLabels[section],
        subtitle: `设置 · ${settingsSectionSummaries[section]}`,
        target: { page: 'settings', section },
      }));
  },
};
