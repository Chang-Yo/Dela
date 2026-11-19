// 设置页装配：模块的设置框架加上依赖外壳状态的分区。
import { views } from '../../views';
import { RemoteSection } from '../../../modules/remotes/view';
import type { ThemePreference, ZoomPreference } from '../../../modules/settings/contract';
import { SettingsView } from '../../../modules/settings/view';
import { useNavigationStore } from '../navigation/view';
import { purgeRemovedEntries } from '../workbench/removed-cleanup';
import { NewRemoteProjectDialog } from '../workspace/remote/NewRemoteProjectDialog';
import { ArchivedSection } from '../../../modules/chat/view';
import { NavEntriesGroup } from './sections/NavEntriesGroup';
import { ShortcutsSection } from './sections/ShortcutsSection';
import { WorkspaceSection } from './sections/WorkspaceSection';

export function SettingsPage(props: {
  fontSize: number;
  onFontSizeChange: (size: number) => Promise<void>;
  onThemeChange: (theme: ThemePreference) => Promise<void>;
  onZoomChange: (zoom: ZoomPreference) => Promise<void>;
  theme: ThemePreference;
  zoom: ZoomPreference;
}) {
  const section = useNavigationStore((state) => state.settingsSection);
  const navigate = useNavigationStore((state) => state.navigate);
  const openProject = useNavigationStore((state) => state.openProject);
  const openSettings = useNavigationStore((state) => state.openSettings);

  return (
    <SettingsView
      {...props}
      navEntries={<NavEntriesGroup />}
      navigate={navigate}
      onSectionChange={openSettings}
      section={section}
      shellSections={{
        shortcuts: <ShortcutsSection />,
        workspace: <WorkspaceSection />,
        archived: <ArchivedSection navigate={navigate} />,
        remotes: (
          <RemoteSection
            NewProjectDialog={NewRemoteProjectDialog}
            onOpenProject={openProject}
            onProjectsRemoved={purgeRemovedEntries}
          />
        ),
      }}
      views={views}
    />
  );
}
