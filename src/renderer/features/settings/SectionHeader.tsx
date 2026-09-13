type SectionHeaderProps = { title: string; description?: string };

export function SectionHeader({ description, title }: SectionHeaderProps) {
  return (
    <header className="grid gap-1">
      <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
      {description ? (
        <p className="text-[13px] leading-relaxed text-muted-foreground">{description}</p>
      ) : null}
    </header>
  );
}
