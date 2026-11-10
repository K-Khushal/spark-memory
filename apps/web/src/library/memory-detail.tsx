import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
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
import { drafts, type Draft } from "./drafts";
import type { Memory } from "./use-library";

const AUTOSAVE_MS = 800;

const savedText = (memory: Memory): Draft => ({
  title: memory.title ?? "",
  body: memory.body ?? "",
  captureNote: memory.captureNote ?? "",
});

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
  /** Resolves true once the server has the changes. */
  onSave: (before: Memory, changes: MemoryEdit) => Promise<boolean>;
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
  /** Resolves true once the server has the changes. */
  onSave: (before: Memory, changes: MemoryEdit) => Promise<boolean>;
  onDelete: (memory: Memory) => void;
}) {
  // An unsaved draft from a page that closed mid-edit comes back first.
  const [initial] = useState(() => drafts.read(memory.id) ?? savedText(memory));
  const [title, setTitle] = useState(initial.title);
  const [body, setBody] = useState(initial.body);
  const [note, setNote] = useState(initial.captureNote);

  // Saves as the person types (debounced), when the dialog closes however it
  // closes, and when the page closes. Until the server has an edit it is
  // also kept as a local draft.
  const live = useRef({ memory, draft: initial, deleted: false });
  /** What the server has, or has been sent. */
  const sent = useRef(savedText(memory));
  useEffect(() => {
    live.current.memory = memory;
  });

  const save = useCallback(
    (closing: boolean) => {
      const { memory, draft, deleted } = live.current;
      if (deleted) return;
      const base = sent.current;
      const changes: MemoryEdit = {};
      if (draft.title.trim() !== base.title) changes.title = draft.title;
      if (draft.captureNote.trim() !== base.captureNote)
        changes.captureNote = draft.captureNote;
      if (!draft.body.trim()) {
        if (closing) {
          toast("Text Can't Be Empty");
          drafts.keep(memory.id, { ...draft, body: base.body });
        }
      } else if (draft.body.trim() !== base.body) changes.body = draft.body;
      if (!Object.keys(changes).length) return;
      sent.current = {
        title: draft.title.trim(),
        body: changes.body === undefined ? base.body : draft.body.trim(),
        captureNote: draft.captureNote.trim(),
      };
      void onSave(memory, changes).then((ok) => {
        if (ok) drafts.saved(memory.id, draft);
        else if (sent.current.body === draft.body.trim()) sent.current = base;
      });
    },
    [onSave]
  );

  useEffect(() => {
    const draft = { title, body, captureNote: note };
    live.current.draft = draft;
    const base = sent.current;
    if (
      title.trim() === base.title &&
      body.trim() === base.body &&
      note.trim() === base.captureNote
    ) {
      return;
    }
    drafts.keep(live.current.memory.id, draft);
    const timer = setTimeout(() => save(false), AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [title, body, note, save]);

  useEffect(() => {
    const onPageHide = () => save(false);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      save(true);
    };
  }, [save]);

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
            live.current.deleted = true;
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
