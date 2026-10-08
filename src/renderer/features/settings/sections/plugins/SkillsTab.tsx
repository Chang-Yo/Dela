import { useEffect, useState } from 'react';
import { RefreshCw, Sparkles } from 'lucide-react';
import type { SkillScope, SkillView } from '../../../../../shared/api';
import { Button } from '../../../../components/ui/button';
import { Switch } from '../../../../components/ui/switch';
import { errorText } from '../../../../workspace/store';
import { cn } from '../../../../lib/utils';
import { SectionHeader } from '../../SectionHeader';

const SCOPE_LABELS: Record<SkillScope, string> = { global: '全局', project: '项目' };

/** 设置 › Skills：全局（~/.dela、~/.agents、~/.zcode）与项目（工作区）技能的发现与启停。 */
export function SkillsTab() {
  // null 表示尚未读到列表，避免闪烁出错误的空态。
  const [skills, setSkills] = useState<SkillView[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 范围过滤（参照 ZCode 的 Skills 面板）：全部 / 全局 / 项目。
  const [scope, setScope] = useState<'all' | SkillScope>('all');

  const refresh = () => {
    void window.dela?.capability
      .listSkills()
      .then(setSkills)
      .catch((cause) => setError(errorText(cause)));
  };

  useEffect(() => {
    refresh();
  }, []);

  // 即时保存 + 失败回滚（与通知/工作区页签一致）。
  const toggle = async (skill: SkillView, next: boolean) => {
    if (!window.dela || busy) return;
    setBusy(true);
    setError(null);
    const previous = skills;
    setSkills(
      (previous ?? []).map((item) =>
        item.name === skill.name ? { ...item, enabled: next } : item,
      ),
    );
    try {
      setSkills(await window.dela.capability.setSkillEnabled(skill.name, next));
    } catch (cause) {
      setSkills(previous);
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  if (!window.dela) {
    return (
      <div className="grid gap-10">
        <SectionHeader title="Skills" />
        <p className="text-[13px] text-ink-3">Skills 仅在桌面端可用。</p>
      </div>
    );
  }

  const visible = (skills ?? []).filter((skill) => scope === 'all' || skill.scope === scope);
  const groups: { scope: SkillScope; items: SkillView[] }[] =
    scope === 'all'
      ? (['global', 'project'] as const).map((value) => ({
          scope: value,
          items: (skills ?? []).filter((skill) => skill.scope === value),
        }))
      : [{ scope, items: visible }];

  return (
    <div className="grid gap-10">
      <SectionHeader
        action={
          <Button aria-label="刷新技能列表" onClick={refresh} size="icon-sm" variant="ghost">
            <RefreshCw />
          </Button>
        }
        title="Skills"
      />
      {skills !== null && skills.length > 0 && (
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-0.5 rounded-card bg-inset p-0.5" role="group">
            {(['all', 'global', 'project'] as const).map((value) => (
              <button
                aria-pressed={scope === value}
                className={cn(
                  'rounded-control px-2.5 py-1 text-[12px] transition-colors',
                  scope === value
                    ? 'bg-surface text-ink shadow-hairline'
                    : 'text-ink-3 hover:text-ink',
                )}
                key={value}
                onClick={() => setScope(value)}
                type="button"
              >
                {value === 'all' ? '全部' : SCOPE_LABELS[value]}
              </button>
            ))}
          </div>
          <span className="text-[12px] tabular-nums text-ink-3">{visible.length} 项</span>
        </div>
      )}
      {skills !== null && skills.length === 0 && (
        <section className="grid gap-2">
          <h2 className="text-base font-semibold">还没有发现 Skill</h2>
          <p className="text-[13px] leading-relaxed text-ink-3">
            在用户主目录的 .dela/skills（或 .agents/skills、.zcode/skills）放入包含 SKILL.md
            的子文件夹（frontmatter 带 name 与 description），或放入工作区的
            .agents/skills，回到此页刷新即可发现并按需启用。
          </p>
        </section>
      )}
      {skills !== null && skills.length > 0 && visible.length === 0 && (
        <p className="text-[13px] text-ink-3">该范围下没有 Skill。</p>
      )}
      {groups.map((group) =>
        group.items.length === 0 ? null : (
          <section className="grid gap-2" key={group.scope}>
            <h2 className="text-base font-semibold">{SCOPE_LABELS[group.scope]} Skills</h2>
            <ul className="grid">
              {group.items.map((skill) => (
                <li
                  className="flex items-center justify-between gap-4 border-b py-3 last:border-0"
                  key={skill.name}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="grid size-8 shrink-0 place-items-center rounded-card bg-hover-2">
                      <Sparkles className="size-4 text-ink-3" strokeWidth={1.8} />
                    </span>
                    <div className="grid min-w-0 gap-0.5">
                      <strong className="truncate text-[13px]">{skill.name}</strong>
                      <span className="truncate text-[12px] text-ink-3" title={skill.description}>
                        {skill.description || '（无描述）'}
                      </span>
                      <span className="truncate text-[12px] text-ink-3" title={skill.path}>
                        {skill.path}
                      </span>
                    </div>
                  </div>
                  <Switch
                    checked={skill.enabled}
                    disabled={busy}
                    label={`启用 ${skill.name}`}
                    onChange={(next) => void toggle(skill, next)}
                  />
                </li>
              ))}
            </ul>
          </section>
        ),
      )}
      {error && (
        <p className="text-[12px] text-red" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
