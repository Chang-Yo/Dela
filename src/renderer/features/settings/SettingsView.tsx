import { useEffect, useState } from 'react';
import { AboutSection } from './sections/AboutSection';
import { AppearanceSection } from './sections/AppearanceSection';
import { GeneralSection } from './sections/GeneralSection';
import { LlmSection } from './sections/LlmSection';
import { NotificationsSection } from './sections/NotificationsSection';
import { PluginsSection } from './sections/PluginsSection';
import { WorkspaceSection } from './sections/WorkspaceSection';
import { ConnectionsSection } from './connections/ConnectionsSection';
import { SettingsNav, type SettingsSectionId } from './SettingsNav';
import { SettingsSearch } from './SettingsSearch';
import type { SettingsSearchItem } from './search-index';
import type { FontScalePreference, ThemePreference, ZoomPreference } from '../../../shared/api';

type SettingsViewProps = {
  fontScale: FontScalePreference;
  onFontScaleChange: (scale: FontScalePreference) => Promise<void>;
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

/** 搜索选中后的高亮时长（毫秒）：滚动定位后 ring 停留足够被看到，再淡出。 */
const HIGHLIGHT_MS = 1800;

export function SettingsView({
  fontScale,
  onFontScaleChange,
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
  // 搜索直达的高亮目标（data-setting-id）；切分类时清空。
  const [highlight, setHighlight] = useState<string | null>(null);

  useEffect(() => {
    if (sectionRequest) setSection(sectionRequest.section);
  }, [sectionRequest]);

  const changeSection = (next: SettingsSectionId) => {
    setHighlight(null);
    setSection(next);
  };

  const selectSearchItem = (item: SettingsSearchItem) => {
    setSection(item.section);
    setHighlight(item.id);
  };

  // 目标项滚动到可视区并短暂加 ring 高亮；目标不在当前渲染树时不动作。
  useEffect(() => {
    if (!highlight) return undefined;
    const frame = requestAnimationFrame(() => {
      const target = document.querySelector(`[data-setting-id="${highlight}"]`);
      if (!target) return;
      target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      target.classList.add('ring-2', 'ring-ring', 'ring-offset-4', 'ring-offset-background');
      window.setTimeout(
        () =>
          target.classList.remove('ring-2', 'ring-ring', 'ring-offset-4', 'ring-offset-background'),
        HIGHLIGHT_MS,
      );
    });
    return () => cancelAnimationFrame(frame);
  }, [highlight, section]);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background md:flex-row">
      <SettingsNav onSectionChange={changeSection} value={section} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="sticky top-0 z-10 bg-background/95 px-4 pb-3 pt-5 backdrop-blur md:px-10 md:pt-8">
          <div className="mx-auto w-full max-w-[760px]">
            <SettingsSearch onSelect={selectSearchItem} />
          </div>
        </div>
        <div className="mx-auto w-full max-w-[760px] px-4 pb-8 pt-5 md:px-10">
          {section === 'general' && <GeneralSection />}
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
          {section === 'notifications' && <NotificationsSection />}
          {section === 'workspace' && <WorkspaceSection />}
          {section === 'llm' && <LlmSection />}
          {section === 'connections' && (
            <ConnectionsSection
              onOpenMail={onOpenMail}
              onOpenShuiyuan={onOpenShuiyuan}
              onOpenTimetable={onOpenTimetable}
            />
          )}
          {section === 'plugins' && <PluginsSection />}
          {section === 'about' && <AboutSection />}
        </div>
      </div>
    </div>
  );
}
