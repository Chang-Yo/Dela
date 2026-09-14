import { useState } from 'react';
import { AboutSection } from './AboutSection';
import { AppearanceSection } from './AppearanceSection';
import { ConnectionsSection } from './ConnectionsSection';
import { LlmSection } from './LlmSection';
import { SettingsNav, type SettingsSectionId } from './SettingsNav';
import type { FontScalePreference, ThemePreference, ZoomPreference } from '../../../shared/api';

type SettingsViewProps = {
  fontScale: FontScalePreference;
  onFontScaleChange: (scale: FontScalePreference) => Promise<void>;
  onOpenMail: () => void;
  onOpenTimetable: () => void;
  onThemeChange: (theme: ThemePreference) => Promise<void>;
  onZoomChange: (zoom: ZoomPreference) => Promise<void>;
  theme: ThemePreference;
  zoom: ZoomPreference;
};

export function SettingsView({
  fontScale,
  onFontScaleChange,
  onOpenMail,
  onOpenTimetable,
  onThemeChange,
  onZoomChange,
  theme,
  zoom,
}: SettingsViewProps) {
  const [section, setSection] = useState<SettingsSectionId>('connections');

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background md:flex-row">
      <SettingsNav onSectionChange={setSection} value={section} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[760px] px-4 py-5 md:px-10 md:py-8">
          {section === 'connections' && (
            <ConnectionsSection onOpenMail={onOpenMail} onOpenTimetable={onOpenTimetable} />
          )}
          {section === 'llm' && <LlmSection />}
          {section === 'appearance' && (
            <AppearanceSection
              fontScale={fontScale}
              onFontScaleChange={onFontScaleChange}
              onThemeChange={onThemeChange}
              onZoomChange={onZoomChange}
              theme={theme}
              zoom={zoom}
            />
          )}
          {section === 'about' && <AboutSection />}
        </div>
      </div>
    </div>
  );
}
