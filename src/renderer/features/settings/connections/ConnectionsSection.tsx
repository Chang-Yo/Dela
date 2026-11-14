import { SectionHeader } from '../SectionHeader';
import { SettingsGroup } from '../SettingsGroup';
import { views } from '../../../../app/views';
import { useNavigationStore } from '../../../navigation/view';

/** 设置 › 凭据：各模块的凭据行由视图定义登记。 */
export function ConnectionsSection() {
  return (
    <div className="grid gap-10">
      <SectionHeader title="凭据" />
      <SettingsGroup>
        <ul className="grid">
          {views.map(({ settings }, index) => {
            const Credential = settings?.credentials;
            return (
              Credential && (
                <Credential key={index} navigate={useNavigationStore.getState().navigate} />
              )
            );
          })}
        </ul>
      </SettingsGroup>
    </div>
  );
}
