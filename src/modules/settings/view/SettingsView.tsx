import type { ReactNode } from 'react';
import type { Navigate, ViewDefinition } from '../../../app/module';
import { AboutSection } from './AboutSection';
import { AppearanceSection } from './AppearanceSection';
import { CapabilitiesSection } from './agent/CapabilitiesSection';
import { CommandsSection } from './agent/CommandsSection';
import { GeneralSection } from './GeneralSection';
import { LlmSection } from './agent/LlmSection';
import { McpSection } from './agent/McpSection';
import { PrivacySection } from './PrivacySection';
import { SkillsSection } from './agent/SkillsSection';
import { TermsSection } from './TermsSection';
import { ConnectionsSection } from './ConnectionsSection';
import { SettingsNav, type SettingsSectionId } from './SettingsNav';
import type { ThemePreference, ZoomPreference } from '../contract';

type SettingsViewProps = {
  section: SettingsSectionId;
  onSectionChange: (section: SettingsSectionId) => void;
  views: ViewDefinition[];
  navigate: Navigate;
  /** 依赖外壳状态的分区（快捷键、工作区、远程、已归档）由外壳给出。 */
  shellSections: Partial<Record<SettingsSectionId, ReactNode>>;
  /** 「通用」页的导航入口组，开关写外壳偏好。 */
  navEntries: ReactNode;
  fontSize: number;
  onFontSizeChange: (size: number) => Promise<void>;
  onThemeChange: (theme: ThemePreference) => Promise<void>;
  onZoomChange: (zoom: ZoomPreference) => Promise<void>;
  theme: ThemePreference;
  zoom: ZoomPreference;
};

export function SettingsView({
  section,
  onSectionChange,
  views,
  navigate,
  shellSections,
  navEntries,
  fontSize,
  onFontSizeChange,
  onThemeChange,
  onZoomChange,
  theme,
  zoom,
}: SettingsViewProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface md:flex-row">
      <SettingsNav onSectionChange={onSectionChange} value={section} />
      <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:none]">
        {/* 内容宽度 912px = 原 760px 增大 20%（用户裁决，2026-10-06）。 */}
        <div className="mx-auto w-full max-w-[57rem] px-4 pb-8 pt-5 md:px-10 md:pt-8">
          {section === 'general' && <GeneralSection navEntries={navEntries} views={views} />}
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
          {shellSections[section]}
          {section === 'connections' && <ConnectionsSection navigate={navigate} views={views} />}
          {section === 'providers' && <LlmSection />}
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
