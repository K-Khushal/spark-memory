import { ArrowUpRightIcon } from "lucide-react";

/** A Memory's way back to its Source: the host and an arrow, always in a new tab. */
export function SourceLink({ href, host }: { href: string; host: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      referrerPolicy="no-referrer"
      dir="ltr"
      className="inline-flex min-h-6 max-w-full items-center gap-1 self-start rounded-chip text-sm text-ink-muted transition-colors duration-(--duration-press) hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <span className="truncate" translate="no">
        {host}
      </span>
      <span className="sr-only">, Opens in New Tab</span>
      <ArrowUpRightIcon className="size-4 shrink-0" aria-hidden />
    </a>
  );
}
