import { SettingRow, SettingsGroup } from '../../settings/view';
import { MagpieInstallButton, MagpieInstallStatus, useMagpieInstall } from './magpie-install';

/** 设置 › 通用：没在引导里装 magpie 插件的人从这里装。 */
export function MagpieControl() {
  const magpie = useMagpieInstall();

  return (
    <div className="grid gap-2">
      <SettingsGroup settingId="magpie">
        <SettingRow
          description="由 magpie 统一管理 Dela 的模型、MCP 服务器和 Skills。"
          settingId="magpie-plugin"
          title="magpie 插件"
        >
          <MagpieInstallButton install={magpie} />
        </SettingRow>
      </SettingsGroup>
      <MagpieInstallStatus install={magpie} />
    </div>
  );
}
