import { MoreHorizontalIcon, Trash2Icon } from "lucide-react";
import {
  Button,
  Menu,
  MenuTrigger,
  MenuContent,
  MenuItem,
  MenuCheckboxItem,
  MenuSeparator,
} from "@spark/ui";
import type { Memory } from "./use-library";
import { memoryName } from "./memory-tile";
import type { ReactNode } from "react";

/**
 * The top of the image and PDF viewers: what the Memory is on the left (its
 * Index state or Upload badge, Partly Indexed), its actions on the right, and
 * the dialog's Close at the very end (the room on the right is its).
 *
 * Wide enough for all of it (22rem of bar, so 200% text asks for twice the
 * pixels), it is one row. Narrower, the actions drop to a row of their own
 * under the status and Close, and wrap within it: nothing overlaps at 320px or
 * large text, and the bar's height follows its content, so the viewer below
 * never guesses it.
 */
export function ViewerBar({
  memory,
  start,
  children,
}: {
  memory: Memory;
  start?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div data-slot="viewer-bar" className="@container shrink-0 bg-canvas">
      <div className="flex min-h-14 flex-col gap-1 py-2 pr-3 pl-3 @[22rem]:flex-row @[22rem]:items-center @[22rem]:justify-between @[22rem]:gap-x-3 @[22rem]:pr-14 pointer-coarse:@[22rem]:pr-16">
        <div className="flex min-h-9 min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 pr-11 pointer-coarse:min-h-(--size-touch) pointer-coarse:pr-14 @[22rem]:pr-0">
          <span
            title={memoryName(memory)}
            className="min-w-0 truncate text-sm text-ink"
          >
            {memoryName(memory)}
          </span>
          {start}
        </div>
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-1 sm:gap-3">
          {children}
        </div>
      </div>
    </div>
  );
}

/** Close box for the viewers: the same size as the icon buttons beside it. */
export const VIEWER_CLOSE =
  "top-2.5 z-10 size-9 bg-transparent pointer-coarse:top-1.5 pointer-coarse:size-(--size-touch)";

/** Shared viewer actions; the property stays visible in Memory detail. */
export function ViewerMore({
  memory,
  onAiOptOut,
  onDelete,
}: {
  memory: Memory;
  onAiOptOut: (memory: Memory, on: boolean) => void;
  onDelete: () => void;
}) {
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button variant="quiet" size="icon" aria-label="More">
          <MoreHorizontalIcon aria-hidden />
        </Button>
      </MenuTrigger>
      <MenuContent align="end" data-theme="dark">
        <MenuCheckboxItem
          checked={memory.aiOptOut}
          onCheckedChange={(on) => onAiOptOut(memory, on)}
        >
          AI Opt-Out
        </MenuCheckboxItem>
        <MenuSeparator />
        <MenuItem className="text-danger" onSelect={onDelete}>
          <Trash2Icon aria-hidden /> Delete
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

export const VIEWER_ARROW =
  "absolute top-1/2 -translate-y-1/2 size-10 rounded-control bg-surface/60 hover:bg-surface active:scale-[0.97] pointer-coarse:hidden";
