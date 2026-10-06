type SectionHeaderProps = { title: string };

export function SectionHeader({ title }: SectionHeaderProps) {
  return (
    <header className="grid gap-1">
      <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
    </header>
  );
}
