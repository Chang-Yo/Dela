import { SectionHeader } from '../SectionHeader';
import { SkillsTab } from './plugins/SkillsTab';

/** 设置 › Skills：工作目录 skills/ 下的技能发现与启停。 */
export function SkillsSection() {
  return (
    <div className="grid gap-5">
      <SectionHeader title="Skills" />
      <SkillsTab />
    </div>
  );
}
