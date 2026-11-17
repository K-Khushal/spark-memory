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
import { MoreHorizontalIcon, RotateCwIcon, Trash2Icon } from "lucide-react";
import { FREE_ALLOWANCE } from "@spark/core";
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogTitle,
  Textarea,
  Input,
  Switch,
  Menu,
  MenuTrigger,
  MenuContent,
  MenuItem,
  cn,
  useBottomObstruction,
} from "@spark/ui";
import type { Draft } from "./drafts";
import {
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

const captureDay = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
});

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
  // The body field opens to its writing height at first focus and stays.
  const [writing, setWriting] = useState(false);
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
  // The status zone takes room only while it has something to say; the
  // Index state line stays mounted inside it so screen readers hear changes.
  const hasStatus = referenceOnly || !!memory.deepFetch || restorable;

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
      <div className="absolute top-3 right-12 z-10 pointer-coarse:right-16">
        <Menu>
          <MenuTrigger asChild>
            <Button variant="quiet" size="icon" aria-label="More">
              <MoreHorizontalIcon aria-hidden />
            </Button>
          </MenuTrigger>
          <MenuContent align="end">
            <MenuItem
              className="text-danger"
              onSelect={() => {
                onDelete(memory);
                onClose();
              }}
            >
              <Trash2Icon aria-hidden /> Delete
            </MenuItem>
          </MenuContent>
        </Menu>
      </div>
      <DialogBody
        ref={body}
        tabIndex={-1}
        className="flex flex-col gap-6 pt-4 pb-6 outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring sm:pt-6"
      >
        <DialogTitle className="sr-only">Memory</DialogTitle>
        {/* In the body, not above it: a title at 200% text can be taller than
            the screen, and the one scroll region must still reach Done. */}
        <div className="flex flex-col gap-1">
          <div className="pr-20 pointer-coarse:pr-24">
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
          <div className="pr-20 text-xs wrap-anywhere text-ink-muted pointer-coarse:pr-24">
            {[
              memory.kind === "text"
                ? "Text"
                : memory.kind === "pdf"
                  ? "PDF"
                  : memory.kind[0]!.toUpperCase() + memory.kind.slice(1),
              ...(["link", "video", "social"].includes(memory.kind) &&
              memory.sourceUrl
                ? [hostOf(memory)]
                : []),
              captureDay.format(new Date(memory.capturedAt)),
            ].join(" · ")}
          </div>
          <div className="flex flex-wrap items-center gap-2">
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
              // (colour, 120ms) and the ring on focus. Once you start writing,
              // or when it is empty, it keeps a 96px well to write in: it never
              // shrinks again on blur, because that would move Done out from
              // under a press. Its edge aligns with the property controls.
              onFocus={() => setWriting(true)}
              className={cn(
                "min-h-0 w-full rounded-control border-transparent bg-transparent p-3 text-base transition-[background-color] duration-(--duration-press) ease-out hover:bg-sunken pointer-coarse:text-[1rem]",
                (writing || !shown.body) && "min-h-24"
              )}
            />
          )}
        </div>
        <div className="divide-y divide-line border-t border-line pt-4">
          <div className="grid min-h-11 grid-cols-1 items-center gap-2 py-1 sm:grid-cols-[7rem_minmax(0,1fr)]">
            <label
              htmlFor={`capture-note-${id}`}
              className="text-sm text-ink-muted"
            >
              Capture Note
            </label>
            <Input
              id={`capture-note-${id}`}
              size="sm"
              value={shown.captureNote}
              onChange={(e) =>
                change({ ...shown, captureNote: e.target.value })
              }
              maxLength={FREE_ALLOWANCE.captureNoteMaxChars}
              dir="auto"
            />
          </div>
          <div className="grid min-h-11 grid-cols-1 items-center gap-2 py-1 sm:grid-cols-[7rem_minmax(0,1fr)]">
            <span id={`category-${id}`} className="text-sm text-ink-muted">
              Category
            </span>
            <CategoryEditor
              key={memory.id}
              memory={memory}
              onSave={onCategories}
              labelledBy={`category-${id}`}
            />
          </div>
          <div className="grid min-h-11 grid-cols-1 items-center gap-2 py-1 sm:grid-cols-[7rem_minmax(0,1fr)]">
            <label
              htmlFor={`ai-opt-out-${id}`}
              className="text-sm text-ink-muted"
            >
              AI Opt-Out
            </label>
            <Switch
              id={`ai-opt-out-${id}`}
              className="justify-self-end"
              checked={memory.aiOptOut}
              onCheckedChange={(on) => onAiOptOut(memory, on)}
            />
          </div>
        </div>
      </DialogBody>
      <div
        className={cn(
          "flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 px-4 sm:px-6",
          hasStatus && "pt-3"
        )}
      >
        {referenceOnly && <ReferenceOnlyBadge className="text-sm" />}
        <DeepFetchStatus memory={memory} onTryAgain={onRetryDeepFetch} />
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
        <Button
          variant="primary"
          size="sm"
          className="sm:hidden"
          onClick={onClose}
        >
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
