import { useEffect, useState } from 'react';
import { AboutSection } from './sections/AboutSection';
import { AppearanceSection } from './sections/AppearanceSection';
import { ArchivedSection } from './sections/ArchivedSection';
import { CapabilitiesSection } from './sections/CapabilitiesSection';
import { CommandsSection } from './sections/CommandsSection';
import { GeneralSection } from './sections/GeneralSection';
import { LlmSection } from './sections/LlmSection';
import { McpSection } from './sections/McpSection';
import { PrivacySection } from './sections/PrivacySection';
import { RemoteSection } from './sections/RemoteSection';
import { ShortcutsSection } from './sections/ShortcutsSection';
import { SkillsSection } from './sections/SkillsSection';
import { TermsSection } from './sections/TermsSection';
import { WorkspaceSection } from './sections/WorkspaceSection';
import { ConnectionsSection } from './connections/ConnectionsSection';
import { SettingsNav, type SettingsSectionId } from './SettingsNav';
import type { ThemePreference, ZoomPreference } from '../../../shared/api';

type SettingsViewProps = {
  fontSize: number;
  onFontSizeChange: (size: number) => Promise<void>;
  onOpenMail: () => void;
  onOpenShuiyuan: () => void;
  onOpenTimetable: () => void;
  onThemeChange: (theme: ThemePreference) => Promise<void>;
  onZoomChange: (zoom: ZoomPreference) => Promise<void>;
  /** 全局搜索选中设置入口时的定位请求;对象每次新建,已在设置页也会触发切换。 */
  sectionRequest?: { section: SettingsSectionId };
  theme: ThemePreference;
  zoom: ZoomPreference;
};

export function SettingsView({
  fontSize,
  onFontSizeChange,
  onOpenMail,
  onOpenShuiyuan,
  onOpenTimetable,
  onThemeChange,
  onZoomChange,
  sectionRequest,
  theme,
  zoom,
}: SettingsViewProps) {
  const [section, setSection] = useState<SettingsSectionId>('general');

  useEffect(() => {
    if (sectionRequest) setSection(sectionRequest.section);
  }, [sectionRequest]);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface md:flex-row">
      <SettingsNav onSectionChange={setSection} value={section} />
      <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:none]">
        {/* 内容宽度 912px = 原 760px 增大 20%（用户裁决，2026-10-06）。 */}
        <div className="mx-auto w-full max-w-[57rem] px-4 pb-8 pt-5 md:px-10 md:pt-8">
          {section === 'general' && <GeneralSection />}
          {section === 'appearance' && (
            <AppearanceSection
              fontSize={fontSize}
              onFontSizeChange={onFontSizeChange}
              onThemeChange={onThemeChange}
              onZoomChange={onZoomChange}
              theme={theme}
              zoom={zoom}
            />
          )}
          {section === 'shortcuts' && <ShortcutsSection />}
          {section === 'workspace' && <WorkspaceSection />}
          {section === 'archived' && <ArchivedSection />}
          {section === 'connections' && (
            <ConnectionsSection
              onOpenMail={onOpenMail}
              onOpenShuiyuan={onOpenShuiyuan}
              onOpenTimetable={onOpenTimetable}
            />
          )}
          {section === 'providers' && <LlmSection />}
          {section === 'remotes' && <RemoteSection />}
          {section === 'capabilities' && <CapabilitiesSection />}
          {section === 'commands' && <CommandsSection />}
          {section === 'skills' && <SkillsSection />}
          {section === 'mcp' && <McpSection />}
          {section === 'about' && <AboutSection />}
          {section === 'privacy' && <PrivacySection />}
          {section === 'terms' && <TermsSection />}
        </div>
      </div>
    </div>
  );
}
