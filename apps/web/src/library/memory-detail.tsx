import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { RotateCwIcon, Trash2Icon } from "lucide-react";
import { FREE_ALLOWANCE } from "@spark/core";
import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  Textarea,
} from "@spark/ui";
import type { Draft } from "./drafts";
import { AiOptOutSwitch, IndexStatus, type IndexingProps } from "./index-state";
import { textOf, type libraryActions } from "./library-actions";
import type { Memory } from "./use-library";
import { MoreLikeThis } from "./why";

const AUTOSAVE_MS = 800;

/** The pending-edit model (library-actions.ts) this dialog is a view of. */
export type Edits = Pick<
  ReturnType<typeof libraryActions>,
  | "editText"
  | "saveEdit"
  | "restoreEdit"
  | "openEdit"
  | "closeEdit"
  | "previewEdit"
  | "watchEdit"
>;

/**
 * Memory detail: the Memory's title, text and Capture note, edited in place.
 * It saves as you type and on close (like Apple Notes), so there is no Save
 * button. When the Memory changed elsewhere it shows the server's copy, and
 * "Restore Your Edit" (inside the dialog, so the keyboard reaches it) puts
 * the refused text back; typing over the server copy leaves the offer up.
 */
export function MemoryDetail({
  memory,
  edits,
  onClose,
  onDelete,
  onRetryIndexing,
  onAiOptOut,
  onMoreLikeThis,
}: {
  memory: Memory | undefined;
  edits: Edits;
  onClose: () => void;
  onDelete: (memory: Memory) => void;
  onMoreLikeThis: (memory: Memory) => void;
} & IndexingProps) {
  return (
    <Dialog open={!!memory} onOpenChange={(open) => !open && onClose()}>
      {memory && (
        <Fields
          key={memory.id}
          memory={memory}
          edits={edits}
          onClose={onClose}
          onDelete={onDelete}
          onRetryIndexing={onRetryIndexing}
          onAiOptOut={onAiOptOut}
          onMoreLikeThis={onMoreLikeThis}
        />
      )}
    </Dialog>
  );
}

function Fields({
  memory,
  edits,
  onClose,
  onDelete,
  onRetryIndexing,
  onAiOptOut,
  onMoreLikeThis,
}: {
  memory: Memory;
  edits: Edits;
  onClose: () => void;
  onDelete: (memory: Memory) => void;
  onMoreLikeThis: (memory: Memory) => void;
} & IndexingProps) {
  const id = memory.id;
  const [opening] = useState(memory);
  const [edit, setEdit] = useState(() => edits.previewEdit(memory));
  const [fields, setFields] = useState<Draft>(
    () => edit?.fields ?? textOf(memory)
  );
  const bodyField = useRef<HTMLTextAreaElement>(null);
  const autosave = useRef<ReturnType<typeof setTimeout>>(undefined);
  const closing = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    // React's StrictMode closes and reopens at once: that is not a close.
    clearTimeout(closing.current);
    const stop = edits.watchEdit(id, setEdit);
    edits.openEdit(opening);
    return () => {
      stop();
      clearTimeout(autosave.current);
      closing.current = setTimeout(() => edits.closeEdit(id));
    };
  }, [edits, id, opening]);

  // With no edit of the person's own (after a refusal, or while only a
  // stored draft is offered) the fields show the server's copy, as the wall.
  const shown = edit?.status === "idle" ? textOf(memory) : fields;

  const change = (next: Draft) => {
    setFields(next);
    edits.editText(memory, next);
    clearTimeout(autosave.current);
    autosave.current = setTimeout(() => edits.saveEdit(id), AUTOSAVE_MS);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      onClose();
    }
  };

  return (
    <DialogContent
      aria-describedby={undefined}
      // Focus the dialog, not the title: focusing the title would select it.
      onOpenAutoFocus={(e) => {
        e.preventDefault();
        (e.currentTarget as HTMLElement | null)?.focus();
      }}
      onKeyDown={onKeyDown}
      className="flex max-h-[min(90dvh,48rem)] max-w-2xl flex-col gap-3 p-6"
    >
      <DialogTitle className="sr-only">Memory</DialogTitle>
      <input
        value={shown.title}
        onChange={(e) => change({ ...shown, title: e.target.value })}
        maxLength={FREE_ALLOWANCE.titleMaxChars}
        placeholder="Title"
        aria-label="Title"
        dir="auto"
        className="mr-8 min-w-0 rounded-chip bg-transparent font-display text-lg font-semibold text-ink placeholder:text-ink-muted"
      />
      <Textarea
        ref={bodyField}
        value={shown.body}
        onChange={(e) => change({ ...shown, body: e.target.value })}
        aria-label="Text"
        dir="auto"
        className="max-h-[55dvh] min-h-40 flex-1 overflow-y-auto border-0 bg-transparent px-0 text-base"
      />
      <input
        value={shown.captureNote}
        onChange={(e) => change({ ...shown, captureNote: e.target.value })}
        maxLength={FREE_ALLOWANCE.captureNoteMaxChars}
        placeholder="Capture Note"
        aria-label="Capture Note"
        dir="auto"
        className="h-10 min-w-0 rounded-control bg-sunken px-3 text-[1rem] text-ink outline-none placeholder:text-ink-muted focus-visible:outline-2 focus-visible:outline-ring md:text-sm"
      />
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Button
            variant="quiet"
            size="sm"
            onClick={() => {
              onDelete(memory);
              onClose();
            }}
          >
            <Trash2Icon aria-hidden /> Delete
          </Button>
          <MoreLikeThis memory={memory} onSelect={onMoreLikeThis} />
          <AiOptOutSwitch memory={memory} onChange={onAiOptOut} />
        </div>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          <div className="flex items-center gap-2">
            <IndexStatus memory={memory} />
            {memory.indexState === "failed" && (
              <Button
                variant="quiet"
                size="sm"
                onClick={() => onRetryIndexing(memory)}
              >
                <RotateCwIcon aria-hidden /> Retry
              </Button>
            )}
          </div>
          {!!edit?.refused?.length && (
            <Button
              variant="quiet"
              size="sm"
              onClick={() => {
                const restored = edits.restoreEdit(id);
                if (restored) setFields(restored);
                // The button goes; focus moves to the restored text.
                bodyField.current?.focus();
              }}
            >
              Restore Your Edit
            </Button>
          )}
          <Button variant="primary" size="sm" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </DialogContent>
  );
}
