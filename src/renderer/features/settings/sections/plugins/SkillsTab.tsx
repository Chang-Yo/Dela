import { useEffect, useState } from 'react';
import { RefreshCw, Sparkles } from 'lucide-react';
import type { SkillView } from '../../../../../shared/api';
import { Button } from '../../../../components/ui/button';
import { Switch } from '../../../../components/ui/switch';
import { errorText } from '../../../../workspace/store';
import { SectionHeader } from '../../SectionHeader';

/** 设置 › Skills：~/.dela/skills 与旧工作目录 skills/ 下的技能发现与启停。 */
export function SkillsTab() {
  // null 表示尚未读到列表，避免闪烁出错误的空态。
  const [skills, setSkills] = useState<SkillView[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        <p className="text-sm text-muted-foreground">Skills 仅在桌面端可用。</p>
      </div>
    );
  }

  return (
    <div className="grid gap-10">
      <SectionHeader
        action={
          <Button aria-label="刷新技能列表" onClick={refresh} size="icon-sm" variant="ghost">
            <RefreshCw />
          </Button>
        }
        description="把含 SKILL.md 的文件夹放入用户主目录的 .dela/skills 即可被发现；移除文件夹即删除。"
        title="Skills"
      />
      {skills !== null && skills.length === 0 && (
        <section className="grid gap-2">
          <h2 className="text-base font-semibold">还没有发现 Skill</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            在用户主目录下创建 .dela/skills 文件夹，放入包含 SKILL.md 的子文件夹（frontmatter 带
            name 与 description），回到此页刷新即可发现并按需启用。
          </p>
        </section>
      )}
      {skills !== null && skills.length > 0 && (
        <ul className="grid">
          {skills.map((skill) => (
            <li
              className="flex items-center justify-between gap-4 border-b py-3 last:border-0"
              key={skill.name}
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-secondary">
                  <Sparkles className="size-4 text-muted-foreground" strokeWidth={1.8} />
                </span>
                <div className="grid min-w-0 gap-0.5">
                  <strong className="truncate text-sm">{skill.name}</strong>
                  <span
                    className="truncate text-xs text-muted-foreground"
                    title={skill.description}
                  >
                    {skill.description || '（无描述）'}
                  </span>
                  <span className="truncate text-xs text-muted-foreground/70" title={skill.path}>
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
      )}
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
