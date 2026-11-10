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
} from "@spark/ui";
import type { Memory } from "./use-library";

/**
 * Memory detail: the Memory's title, text and Capture note, edited in place.
 * Closing saves (like Apple Notes), so there is no Save button to miss.
 */
export function MemoryDetail({
  memory,
  onClose,
  onSave,
  onDelete,
}: {
  memory: Memory | undefined;
  onClose: () => void;
  onSave: (before: Memory, changes: MemoryEdit) => void;
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
  onSave: (before: Memory, changes: MemoryEdit) => void;
  onDelete: (memory: Memory) => void;
}) {
  const [title, setTitle] = useState(memory.title ?? "");
  const [body, setBody] = useState(memory.body ?? "");
  const [note, setNote] = useState(memory.captureNote ?? "");

  // Closing saves, however it closes (Done, Escape, ⌘Enter, the close
  // button, a click outside): the edit is sent when the fields go away.
  const latest = useRef({ title, body, note, deleted: false });
  useEffect(() => {
    latest.current = { ...latest.current, title, body, note };
  });
  useEffect(
    () => () => {
      const { title, body, note, deleted } = latest.current;
      if (deleted) return;
      const changes: MemoryEdit = {};
      if (title.trim() !== (memory.title ?? "")) changes.title = title;
      if (body.trim() && body.trim() !== memory.body) changes.body = body;
      if (note.trim() !== (memory.captureNote ?? ""))
        changes.captureNote = note;
      if (Object.keys(changes).length) onSave(memory, changes);
    },
    [memory, onSave]
  );
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
        className="mr-8 min-w-0 bg-transparent font-display text-lg font-semibold text-ink outline-none placeholder:text-ink-muted"
      />
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        maxLength={FREE_ALLOWANCE.textMaxChars}
        aria-label="Text"
        aria-invalid={!body.trim() || undefined}
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
            latest.current.deleted = true;
            onDelete(memory);
            onClose();
          }}
        >
          <Trash2Icon aria-hidden /> Delete
        </Button>
        <Button variant="primary" size="sm" onClick={onClose}>
          Done
        </Button>
      </div>
    </DialogContent>
  );
}
