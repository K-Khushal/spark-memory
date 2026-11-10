import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Trash2Icon } from "lucide-react";
import type { MemoryEdit } from "@spark/core";
import { FREE_ALLOWANCE } from "@spark/core";
import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  Textarea,
  toast,
} from "@spark/ui";
import { drafts } from "./drafts";
import { editSession } from "./edit-session";
import type { EditOutcome } from "./library-actions";
import type { Memory } from "./use-library";

const AUTOSAVE_MS = 800;

/**
 * Memory detail: the Memory's title, text and Capture note, edited in place.
 * It saves as you type and on close (like Apple Notes), so there is no Save
 * button to miss.
 */
export function MemoryDetail({
  memory,
  onClose,
  onSave,
  onDelete,
}: {
  memory: Memory | undefined;
  onClose: () => void;
  onSave: (before: Memory, changes: MemoryEdit) => Promise<EditOutcome>;
  onDelete: (memory: Memory) => void;
}) {
  return (
    <Dialog open={!!memory} onOpenChange={(open) => !open && onClose()}>
      {memory && (
        <Fields
          key={memory.id}
          memory={memory}
          onClose={onClose}
          onSave={onSave}
          onDelete={onDelete}
        />
      )}
    </Dialog>
  );
}

function Fields({
  memory,
  onClose,
  onSave,
  onDelete,
}: {
  memory: Memory;
  onClose: () => void;
  onSave: (before: Memory, changes: MemoryEdit) => Promise<EditOutcome>;
  onDelete: (memory: Memory) => void;
}) {
  // Saving, drafts and conflicts live in the session (edit-session.ts);
  // this component only holds the field text and the timers.
  const [session] = useState(() =>
    editSession({
      start: memory,
      drafts,
      save: onSave,
      notify: toast,
    })
  );
  const [title, setTitle] = useState(session.initial.title);
  const [body, setBody] = useState(session.initial.body);
  const [note, setNote] = useState(session.initial.captureNote);
  useEffect(() => session.seen(memory), [session, memory]);
  const [offered, setOffered] = useState(session.offered);
  const bodyField = useRef<HTMLTextAreaElement>(null);
  useEffect(
    () =>
      session.listen({
        show: (fields) => {
          setTitle(fields.title);
          setBody(fields.body);
          setNote(fields.captureNote);
        },
        offer: setOffered,
      }),
    [session]
  );

  useEffect(() => {
    if (!session.change({ title, body, captureNote: note })) return;
    const timer = setTimeout(() => session.flush(false), AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [session, title, body, note]);

  useEffect(() => {
    session.open();
    const onPageHide = () => session.flush(false);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      session.close();
    };
  }, [session]);

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
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={FREE_ALLOWANCE.titleMaxChars}
        placeholder="Title"
        aria-label="Title"
        dir="auto"
        className="mr-8 min-w-0 rounded-chip bg-transparent font-display text-lg font-semibold text-ink placeholder:text-ink-muted"
      />
      <Textarea
        ref={bodyField}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        aria-label="Text"
        dir="auto"
        className="max-h-[55dvh] min-h-40 flex-1 overflow-y-auto border-0 bg-transparent px-0 text-base"
      />
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={FREE_ALLOWANCE.captureNoteMaxChars}
        placeholder="Capture Note"
        aria-label="Capture Note"
        dir="auto"
        className="h-10 min-w-0 rounded-control bg-sunken px-3 text-[1rem] text-ink outline-none placeholder:text-ink-muted focus-visible:outline-2 focus-visible:outline-ring md:text-sm"
      />
      <div className="flex justify-between gap-2 pt-1">
        <Button
          variant="quiet"
          size="sm"
          onClick={() => {
            session.deleted();
            onDelete(memory);
            onClose();
          }}
        >
          <Trash2Icon aria-hidden /> Delete
        </Button>
        <div className="flex gap-2">
          {offered && (
            <Button
              variant="quiet"
              size="sm"
              onClick={() => {
                session.restore();
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
