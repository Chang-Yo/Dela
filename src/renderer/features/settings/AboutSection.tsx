import delaLogo from '../../../../assets/Dela_Logo.png';
import { SectionHeader } from './SectionHeader';

export function AboutSection() {
  return (
    <div className="grid gap-5">
      <SectionHeader title="关于" />
      <section className="grid justify-items-center gap-2.5 rounded-xl border bg-card px-6 py-10 text-center">
        <img alt="Dela" className="h-12 w-auto" src={delaLogo} />
        <div className="grid gap-1">
          <h2 className="text-base font-semibold tracking-tight">Dela</h2>
          <p className="text-xs text-muted-foreground">本地优先的项目工作台</p>
        </div>
        <p className="text-xs text-muted-foreground">版本 {window.dela?.version ?? '浏览器预览'}</p>
      </section>
    </div>
  );
}
