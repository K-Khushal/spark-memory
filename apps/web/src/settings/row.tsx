import type { ReactNode } from "react";

export function SettingsRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-12 flex-wrap items-center justify-between gap-3 border-b border-line text-sm last:border-b-0">
      <span>{label}</span>
      {children}
    </div>
  );
}
