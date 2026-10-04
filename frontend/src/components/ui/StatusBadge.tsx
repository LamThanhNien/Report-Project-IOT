import { cn } from "../../lib/cn";
import { TONE_CLASSES, type StatusTone } from "../../lib/status";

interface Props {
  tone: StatusTone;
  label: string;
  dot?: boolean;
  size?: "default" | "sm";
  className?: string;
}

export function StatusBadge({ tone, label, dot = true, size = "default", className }: Props) {
  const t = TONE_CLASSES[tone];
  return (
    <span className={cn(
      "chip",
      size === "sm" && "text-[9px] px-1.5 h-4 min-h-[16px]",
      t.chip,
      className,
    )}>
      {dot && <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", t.dot)} />}
      {label}
    </span>
  );
}
