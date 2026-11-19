import { Switch } from '../../../../ui/switch';
import { SettingRow, SettingsGroup } from '../../../../modules/settings/view';
import { usePreferences } from '../../shell/preferences';
import { navEntries } from '../../navigation/entries';

export function NavEntriesGroup() {
  const hiddenEntries = usePreferences((state) => state.hiddenNavEntries);
  const setEntryVisible = usePreferences((state) => state.setNavEntryVisible);

  return (
    <div className="grid gap-2">
      <SettingsGroup settingId="nav-entries" title="导航入口">
        {navEntries.map((entry) => (
          <SettingRow key={entry.id} settingId={`nav-entry-${entry.id}`} title={entry.label}>
            <Switch
              checked={!hiddenEntries.includes(entry.id)}
              label={`在导航中显示${entry.label}`}
              onChange={(next) => setEntryVisible(entry.id, next)}
            />
          </SettingRow>
        ))}
      </SettingsGroup>
    </div>
  );
}
