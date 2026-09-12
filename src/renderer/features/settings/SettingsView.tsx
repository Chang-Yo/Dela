import { useState } from 'react';
import { AboutSection } from './AboutSection';
import { AppearanceSection } from './AppearanceSection';
import { ConnectionsSection } from './ConnectionsSection';
import { SettingsNav, type SettingsSectionId } from './SettingsNav';

type SettingsViewProps = {
  onOpenMail: () => void;
  onOpenTimetable: () => void;
  onOpenSources: () => void;
};

export function SettingsView({ onOpenMail, onOpenTimetable, onOpenSources }: SettingsViewProps) {
  const [section, setSection] = useState<SettingsSectionId>('connections');

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background md:flex-row">
      <SettingsNav onSectionChange={setSection} value={section} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[760px] px-4 py-5 md:px-10 md:py-8">
          {section === 'connections' && (
            <ConnectionsSection
              onOpenMail={onOpenMail}
              onOpenTimetable={onOpenTimetable}
              onOpenSources={onOpenSources}
            />
          )}
          {section === 'appearance' && <AppearanceSection />}
          {section === 'about' && <AboutSection />}
        </div>
      </div>
    </div>
  );
}
