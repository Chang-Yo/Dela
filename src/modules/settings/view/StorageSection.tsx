import type { ViewDefinition } from '../../../app/module';
import { CacheUsage } from './CacheUsage';
import { SectionHeader } from './SectionHeader';
import { SettingsGroup } from './SettingsGroup';

export function StorageSection({ views }: { views: ViewDefinition[] }) {
  return (
    <div className="grid gap-10">
      <SectionHeader title="存储" />
      <div className="grid gap-2">
        <SettingsGroup>
          {views.map(({ settings }, index) => {
            const Storage = settings?.storage;
            return Storage && <Storage key={index} />;
          })}
        </SettingsGroup>
      </div>
      <CacheUsage />
    </div>
  );
}
