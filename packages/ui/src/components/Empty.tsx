import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export function Empty({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      <div className="grid h-12 w-12 place-items-center rounded-2xl bg-bg-elevated text-fg-subtle">
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <p className="text-sm font-medium text-fg">{title}</p>
        {description && <p className="mt-1 text-xs text-fg-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}
