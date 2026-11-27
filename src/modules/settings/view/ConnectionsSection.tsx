import { SectionHeader } from './SectionHeader';
import { SettingsGroup } from './SettingsGroup';
import type { Navigate, ViewDefinition } from '../../../app/module';

export function ConnectionsSection({
  navigate,
  views,
}: {
  navigate: Navigate;
  views: ViewDefinition[];
}) {
  return (
    <div className="grid gap-10">
      <SectionHeader title="凭据" />
      <SettingsGroup>
        <ul className="grid">
          {views.map(({ settings }, index) => {
            const Credential = settings?.credentials;
            return Credential && <Credential key={index} navigate={navigate} />;
          })}
        </ul>
      </SettingsGroup>
    </div>
  );
}
