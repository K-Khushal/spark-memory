import { SearchByImage } from "./image-query";
import { CategoryEditor, type CategoryEdit } from "./categories";
import { restoreLibraryFocus } from "./focus";
import { TitleField } from "./title-field";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
} from "react";
import { RotateCwIcon, Trash2Icon } from "lucide-react";
import { FREE_ALLOWANCE } from "@spark/core";
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogTitle,
  Textarea,
  cn,
  useBottomObstruction,
} from "@spark/ui";
import type { Draft } from "./drafts";
import {
  AiOptOutSwitch,
  DeepFetchStatus,
  IndexStatus,
  type IndexingProps,
} from "./index-state";
import { textOf, type libraryActions } from "./library-actions";
import {
  hostOf,
  isReferenceOnly,
  memoryName,
  ReferenceOnlyBadge,
} from "./memory-tile";
import { SourceLink } from "./source-link";
import type { Memory } from "./use-library";
import { VideoReader } from "./video-reader";
import { MoreLikeThis } from "./why";

const AUTOSAVE_MS = 800;

const PHONE = "(max-width: 639px)";
/** True below 640px, where Memory detail is a sheet on the bottom edge. */
function useIsPhone() {
  return useSyncExternalStore(
    (notify) => {
      const query = window.matchMedia(PHONE);
      query.addEventListener("change", notify);
      return () => query.removeEventListener("change", notify);
    },
    () => window.matchMedia(PHONE).matches,
    () => false
  );
}

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
  seconds,
  edits,
  onClose,
  onDelete,
  onRetryIndexing,
  onRetryDeepFetch,
  onAiOptOut,
  onCategories,
  onMoreLikeThis,
  onSearchByImage,
}: {
  seconds?: number;
  memory: Memory | undefined;
  edits: Edits;
  onClose: () => void;
  onDelete: (memory: Memory) => void;
  onRetryDeepFetch: (memory: Memory) => void;
  onMoreLikeThis: (memory: Memory) => void;
  onSearchByImage?: (memory: Memory) => void;
} & IndexingProps & { onCategories?: CategoryEdit }) {
  return (
    <Dialog open={!!memory} onOpenChange={(open) => !open && onClose()}>
      {memory && (
        <Fields
          key={memory.id}
          memory={memory}
          seconds={seconds}
          edits={edits}
          onClose={onClose}
          onDelete={onDelete}
          onRetryIndexing={onRetryIndexing}
          onRetryDeepFetch={onRetryDeepFetch}
          onCategories={onCategories}
          onAiOptOut={onAiOptOut}
          onMoreLikeThis={onMoreLikeThis}
          onSearchByImage={onSearchByImage}
        />
      )}
    </Dialog>
  );
}

function Fields({
  memory,
  seconds,
  edits,
  onClose,
  onDelete,
  onRetryIndexing,
  onRetryDeepFetch,
  onAiOptOut,
  onCategories,
  onMoreLikeThis,
  onSearchByImage,
}: {
  seconds?: number;
  memory: Memory;
  edits: Edits;
  onClose: () => void;
  onDelete: (memory: Memory) => void;
  onRetryDeepFetch: (memory: Memory) => void;
  onMoreLikeThis: (memory: Memory) => void;
  onSearchByImage?: (memory: Memory) => void;
} & IndexingProps & { onCategories?: CategoryEdit }) {
  const id = memory.id;
  const [opening] = useState(memory);
  const [edit, setEdit] = useState(() => edits.previewEdit(memory));
  const [fields, setFields] = useState<Draft>(
    () => edit?.fields ?? textOf(memory)
  );
  const body = useRef<HTMLDivElement>(null);
  const footer = useRef<HTMLDivElement | null>(null);
  // The sheet mounts in a portal after this renders: wait for the footer.
  const [footerMounted, setFooterMounted] = useState(false);
  const footerRef = useCallback((node: HTMLDivElement | null) => {
    footer.current = node;
    setFooterMounted(!!node);
  }, []);
  // On a phone the sheet sits on the bottom edge, where a toast (Undo) would
  // cover Done: the footer tells the toaster how tall it is.
  useBottomObstruction(footer, useIsPhone() && footerMounted);
  const bodyField = useRef<HTMLTextAreaElement>(null);
  const titleField = useRef<HTMLTextAreaElement>(null);
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

  const referenceOnly = isReferenceOnly(memory);
  const restorable = !!edit?.refused?.length;
  const failedOrIndexing =
    memory.indexState === "failed" || memory.indexState === "indexing";
  // The status zone takes room only while it has something to say; the
  // Index state line stays mounted inside it so screen readers hear changes.
  const hasStatus =
    referenceOnly || failedOrIndexing || !!memory.deepFetch || restorable;

  return (
    <DialogContent
      presentation="sheet"
      onCloseAutoFocus={(event) => restoreLibraryFocus(event, id)}
      aria-describedby={undefined}
      // Focus the scrolling body, not the title (focusing the title would
      // select it): ↑ ↓ and Space scroll the reading at once.
      onOpenAutoFocus={(e) => {
        e.preventDefault();
        body.current?.focus({ preventScroll: true });
      }}
      onKeyDown={onKeyDown}
      className="flex max-h-[min(90dvh,48rem)] max-w-2xl flex-col"
    >
      <DialogBody
        ref={body}
        tabIndex={-1}
        className="flex flex-col gap-6 pt-4 pb-4 outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring sm:pt-6"
      >
        <DialogTitle className="sr-only">Memory</DialogTitle>
        {/* In the body, not above it: a title at 200% text can be taller than
            the screen, and the one scroll region must still reach Done. */}
        <div className="flex flex-col gap-1">
          <div className="pr-8 pointer-coarse:pr-12">
            <TitleField
              ref={titleField}
              value={shown.title}
              onChange={(title) => change({ ...shown, title })}
              maxLength={FREE_ALLOWANCE.titleMaxChars}
              // A link with no title of its own goes by its host, as on the wall.
              placeholder={
                memory.kind === "link" || memory.kind === "video"
                  ? memoryName(memory) || "Title"
                  : "Title"
              }
            />
          </div>
          {memory.kind === "video" ? (
            <VideoReader memory={memory} seconds={seconds} />
          ) : memory.kind === "link" ? (
            <Reader memory={memory} />
          ) : (
            <Textarea
              ref={bodyField}
              value={shown.body}
              onChange={(e) => change({ ...shown, body: e.target.value })}
              aria-label="Text"
              dir="auto"
              // Reads as text (base/24) with no chrome at rest, sized to what it
              // holds: a one-line note is one line. The surface appears on hover
              // (colour, 120ms) and the ring on focus; only then, or when empty,
              // does it open to 96px to write in. The 12px inset keeps the ring
              // off the glyphs and the words in line with the Title above.
              className={cn(
                "-mx-3 min-h-0 w-[calc(100%+1.5rem)] max-w-none border-0 bg-transparent p-3 text-base transition-[background-color] duration-(--duration-press) ease-out hover:bg-sunken focus:min-h-24 focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:text-[1rem]",
                !shown.body && "min-h-24"
              )}
            />
          )}
        </div>
        <div className="flex flex-col gap-2">
          <input
            value={shown.captureNote}
            onChange={(e) => change({ ...shown, captureNote: e.target.value })}
            maxLength={FREE_ALLOWANCE.captureNoteMaxChars}
            placeholder="Capture Note"
            aria-label="Capture Note"
            dir="auto"
            className="h-10 min-w-0 shrink-0 rounded-control bg-sunken px-3 pointer-coarse:h-(--size-touch) text-[1rem] text-ink placeholder:text-ink-muted focus-visible:outline-2 focus-visible:outline-ring md:text-sm"
          />
          <CategoryEditor
            key={memory.id}
            memory={memory}
            onSave={onCategories}
          />
        </div>
        <div
          role="group"
          aria-label="Actions"
          className="flex flex-wrap items-center gap-x-4 gap-y-2"
        >
          <AiOptOutSwitch memory={memory} onChange={onAiOptOut} />
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
        </div>
      </DialogBody>
      <div
        className={cn(
          "flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 px-4 sm:px-6",
          hasStatus && "pt-3"
        )}
      >
        {referenceOnly && <ReferenceOnlyBadge className="text-sm" />}
        <IndexStatus memory={memory} />
        <DeepFetchStatus memory={memory} onTryAgain={onRetryDeepFetch} />
        {memory.indexState === "failed" && (
          <Button
            variant="quiet"
            size="sm"
            onClick={() => onRetryIndexing(memory)}
          >
            <RotateCwIcon aria-hidden /> Retry
          </Button>
        )}
        {restorable && (
          <Button
            variant="quiet"
            size="sm"
            onClick={() => {
              const restored = edits.restoreEdit(id);
              if (restored) setFields(restored);
              // The button goes; focus moves to the restored text.
              (bodyField.current ?? titleField.current)?.focus();
            }}
          >
            Restore Your Edit
          </Button>
        )}
      </div>
      <DialogFooter ref={footerRef} className="justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <MoreLikeThis memory={memory} onSelect={onMoreLikeThis} />
          <SearchByImage memory={memory} onSelect={onSearchByImage} />
        </div>
        <Button variant="primary" size="sm" onClick={onClose}>
          Done
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

/** Only a web link is ever an href: the server keeps http(s) Sources alone, and so does this. */
const webLink = (url: string | null) =>
  url && /^https?:\/\//i.test(url) ? url : undefined;

/**
 * A link's reader view: the Source, then its Preserved copy as plain
 * paragraphs (React text, so nothing from the page can run or load), or
 * the page's description when it is Reference Only.
 */
function Reader({ memory }: { memory: Memory }) {
  const text = memory.body || memory.description || "";
  const href = webLink(memory.sourceUrl);
  return (
    <div className="flex flex-col gap-3">
      {href && <SourceLink href={href} host={hostOf(memory)} />}
      {text && (
        // The Memory detail body is the one scrolling region.
        <article
          aria-label="Text"
          dir="auto"
          className="text-base break-words text-ink"
        >
          {text
            .split(/\n\s*\n/)
            .filter((paragraph) => paragraph.trim())
            .map((paragraph, i) => (
              <p
                key={i}
                className="mb-4 max-w-[65ch] whitespace-pre-line last:mb-0"
              >
                {paragraph}
              </p>
            ))}
        </article>
      )}
    </div>
  );
}
