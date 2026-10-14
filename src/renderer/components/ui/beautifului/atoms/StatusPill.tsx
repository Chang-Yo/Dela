import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const statusPillVariants = cva(
  "inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-13 font-medium leading-none",
  {
    variants: {
      tone: {
        green: "bg-green-tint text-green",
        orange: "bg-orange-tint text-orange",
        red: "bg-red-tint text-red",
        accent: "bg-bui-accent-tint text-bui-accent-ink",
        neutral: "bg-inset text-ink-2",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

type Tone = NonNullable<VariantProps<typeof statusPillVariants>["tone"]>;

/* the leading dot lives on a separate element, so its color stays a small lookup */
const dotColor: Record<Tone, string> = {
  green: "bg-green",
  orange: "bg-orange",
  red: "bg-red",
  accent: "bg-bui-accent",
  neutral: "bg-ink-3",
};

export function StatusPill({
  tone = "neutral",
  children,
  dot = true,
  className,
}: {
  tone?: Tone;
  children: React.ReactNode;
  dot?: boolean;
  className?: string;
}) {
  return (
    <span className={cn(statusPillVariants({ tone }), className)}>
      {dot && <span className={cn("size-1.5 rounded-full", dotColor[tone])} />}
      {children}
    </span>
  );
}
