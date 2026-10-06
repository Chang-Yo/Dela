type SectionHeaderProps = { title: string };

export function SectionHeader({ title }: SectionHeaderProps) {
  return <h1 className="text-lg font-semibold tracking-tight">{title}</h1>;
}
