import { useId, useState, type FormEvent, type KeyboardEvent } from "react";
import {
  CATEGORY_NAME_MAX_CHARS,
  checkCategoryName,
  MAX_CUSTOM_CATEGORIES,
} from "@spark/core";
import {
  PencilIcon,
  SlidersHorizontalIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
  FilterChip,
  Input,
  cn,
} from "@spark/ui";
import {
  PROBLEM_LABELS,
  type CategoriesState,
  type CategoryProblem,
  type CategoryRun,
  type OwnCategory,
} from "./own-categories";

export type CategoryActions = {
  /** A problem, or undefined once it is done. */
  create: (name: string) => Promise<CategoryProblem | undefined>;
  rename: (
    category: OwnCategory,
    name: string
  ) => Promise<CategoryProblem | undefined>;
  remove: (category: OwnCategory) => Promise<CategoryProblem | undefined>;
};

/** The count of Memories re-categorised so far, as a thin bar and "12 of 40". */
export function CategoriseProgress({
  run,
  className,
}: {
  run: CategoryRun;
  className?: string;
}) {
  const share = run.total ? Math.min(1, run.done / run.total) : 0;
  return (
    <div
      role="progressbar"
      aria-label="Categorising"
      aria-valuemin={0}
      aria-valuemax={run.total}
      aria-valuenow={run.done}
      aria-valuetext={`${run.done} of ${run.total}`}
      className={cn("flex flex-col gap-1.5", className)}
    >
      <span className="h-0.5 overflow-hidden rounded-chip bg-line">
        <span
          className="block h-full origin-left bg-ink transition-transform duration-180 ease-out motion-reduce:transition-none"
          style={{ transform: `scaleX(${share})` }}
        />
      </span>
      <span className="text-xs text-ink-muted tabular-nums">
        {run.done} of {run.total}
      </span>
    </div>
  );
}

/**
 * Opens the Categories dialog: make, rename and delete the person's own.
 * `layout` is the sidebar's quiet row or the phone's chip.
 */
export function ManageCategories({
  layout,
  state,
  actions,
}: {
  layout: "sidebar" | "row";
  state: CategoriesState | undefined;
  actions: CategoryActions;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {layout === "row" ? (
        <FilterChip
          aria-label="Manage Categories"
          aria-haspopup="dialog"
          onClick={() => setOpen(true)}
        >
          <SlidersHorizontalIcon aria-hidden className="size-4" />
        </FilterChip>
      ) : (
        <button
          type="button"
          aria-haspopup="dialog"
          onClick={() => setOpen(true)}
          className="flex h-8 w-full items-center gap-2 rounded-control px-2 text-left text-sm text-ink-muted transition-[color] duration-(--duration-press) ease-out hover:text-ink"
        >
          <SlidersHorizontalIcon aria-hidden className="size-4 shrink-0" />
          <span className="truncate">Manage Categories</span>
        </button>
      )}
      {/* The sidebar's copy is the one that shows the progress; the dialog has its own. */}
      {layout === "sidebar" && state?.run && (
        <CategoriseProgress run={state.run} className="px-2 pt-1" />
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          presentation="sheet"
          aria-describedby={undefined}
          className="flex max-h-[min(36rem,calc(100dvh-2rem))] max-w-md flex-col overflow-hidden"
        >
          <DialogHeader>
            <DialogTitle className="wrap-anywhere">Categories</DialogTitle>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-4">
            <CategoriesManager state={state} actions={actions} />
          </DialogBody>
          <DialogFooter>
            <Button wrap onClick={() => setOpen(false)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** The new-name field, the person's Categories and the progress. */
function CategoriesManager({
  state,
  actions,
}: {
  state: CategoriesState | undefined;
  actions: CategoryActions;
}) {
  const categories = state?.categories ?? [];
  const [confirming, setConfirming] = useState<OwnCategory>();
  return (
    <>
      <NameForm
        label="Category Name"
        placeholder="New Category"
        submit="Add"
        names={categories.map((c) => c.name)}
        limited={categories.length >= MAX_CUSTOM_CATEGORIES}
        onSubmit={actions.create}
      />
      {state?.run && <CategoriseProgress run={state.run} />}
      {categories.length > 0 && (
        <ul
          aria-label="Your Categories"
          className="-mx-2 flex shrink-0 flex-col gap-1 px-2"
        >
          {categories.map((category) => (
            <CategoryRow
              key={category.id}
              category={category}
              names={categories.map((c) => c.name)}
              onRename={(name) => actions.rename(category, name)}
              onDelete={() => setConfirming(category)}
            />
          ))}
        </ul>
      )}
      <Dialog
        open={!!confirming}
        onOpenChange={(open) => !open && setConfirming(undefined)}
      >
        {confirming && (
          <ConfirmDelete
            category={confirming}
            onCancel={() => setConfirming(undefined)}
            onConfirm={async () => {
              const problem = await actions.remove(confirming);
              if (!problem) setConfirming(undefined);
              return problem;
            }}
          />
        )}
      </Dialog>
    </>
  );
}

/** A name field with its message under it; Enter submits. */
function NameForm({
  label,
  placeholder,
  submit,
  names,
  limited = false,
  initial = "",
  autoFocus = true,
  onSubmit,
  onCancel,
}: {
  label: string;
  placeholder?: string;
  submit: string;
  /** The other names in play (the person's own), for the duplicate check. */
  names: string[];
  limited?: boolean;
  initial?: string;
  autoFocus?: boolean;
  onSubmit: (name: string) => Promise<CategoryProblem | undefined>;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [refused, setRefused] = useState<CategoryProblem>();
  const messageId = useId();
  // The same rule the server applies, so most refusals never leave the page.
  const checked = checkCategoryName(name, names);
  const problem =
    refused ??
    (name.trim() && "problem" in checked ? checked.problem : undefined) ??
    (limited && !initial ? "limit" : undefined);
  const unchanged = initial !== "" && name.trim() === initial;
  const ready = !!name.trim() && !problem && !unchanged && !saving;

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    setSaving(true);
    const result = await onSubmit(name);
    setSaving(false);
    if (result) return setRefused(result);
    setName(initial);
  }
  const keys = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || !onCancel) return;
    // The dialog is not closed by the Escape that only cancels this edit.
    event.stopPropagation();
    onCancel();
  };

  return (
    <form
      onSubmit={send}
      className="flex shrink-0 flex-col gap-2"
      onKeyDown={keys}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label={label}
          aria-describedby={problem ? messageId : undefined}
          aria-invalid={!!problem}
          autoFocus={autoFocus}
          autoComplete="off"
          maxLength={CATEGORY_NAME_MAX_CHARS * 2}
          placeholder={placeholder}
          value={name}
          dir="auto"
          className="basis-32 flex-1 aria-invalid:border-line-strong"
          onChange={(event) => {
            setName(event.target.value);
            setRefused(undefined);
          }}
        />
        <Button
          wrap
          type="submit"
          variant="primary"
          size="md"
          className="h-11"
          disabled={!ready}
        >
          {submit}
        </Button>
        {onCancel && (
          <Button
            type="button"
            variant="quiet"
            size="icon"
            aria-label="Cancel"
            onClick={onCancel}
          >
            <XIcon aria-hidden />
          </Button>
        )}
      </div>
      <p
        id={messageId}
        role="alert"
        className={cn("min-h-5 text-sm text-ink", !problem && "sr-only")}
      >
        {problem && PROBLEM_LABELS[problem]}
      </p>
    </form>
  );
}

/** One Category: its name, Rename and Delete; Rename turns the name into a field. */
function CategoryRow({
  category,
  names,
  onRename,
  onDelete,
}: {
  category: OwnCategory;
  names: string[];
  onRename: (name: string) => Promise<CategoryProblem | undefined>;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <li>
        <NameForm
          label={`New Name for ${category.name}`}
          submit="Save"
          initial={category.name}
          names={names.filter((n) => n !== category.name)}
          onCancel={() => setEditing(false)}
          onSubmit={async (name) => {
            const problem = await onRename(name);
            if (!problem) setEditing(false);
            return problem;
          }}
        />
      </li>
    );
  }
  return (
    <li className="flex min-h-10 shrink-0 items-center gap-1 rounded-control py-1 pl-2">
      <span className="min-w-0 flex-1 wrap-anywhere text-sm" dir="auto">
        {category.name}
      </span>
      <Button
        variant="quiet"
        size="icon-sm"
        aria-label={`Rename ${category.name}`}
        onClick={() => setEditing(true)}
      >
        <PencilIcon aria-hidden />
      </Button>
      <Button
        variant="quiet"
        size="icon-sm"
        aria-label={`Delete ${category.name}`}
        onClick={onDelete}
      >
        <Trash2Icon aria-hidden />
      </Button>
    </li>
  );
}

/** Names the Category and how many Memories lose it; no Memory is deleted. */
function ConfirmDelete({
  category,
  onCancel,
  onConfirm,
}: {
  category: OwnCategory;
  onCancel: () => void;
  onConfirm: () => Promise<CategoryProblem | undefined>;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const count = category.memories;
  const described = useId();
  return (
    <DialogContent
      presentation="sheet"
      role="alertdialog"
      aria-describedby={described}
      className="flex max-h-[calc(100dvh-2rem)] max-w-sm flex-col overflow-hidden"
      closeLabel="Close"
    >
      <DialogHeader>
        <DialogTitle className="wrap-anywhere" dir="auto">
          Delete {category.name}
        </DialogTitle>
      </DialogHeader>
      <DialogBody>
        <p id={described} className="text-sm">
          {count === 0
            ? "No Memories have it."
            : `${count} ${count === 1 ? "Memory loses" : "Memories lose"} it. No Memory is deleted.`}
        </p>
      </DialogBody>
      <DialogFooter>
        {failed && (
          <span role="alert" className="mr-auto text-sm">
            {PROBLEM_LABELS.failed}
          </span>
        )}
        <Button variant="outline" onClick={onCancel} autoFocus>
          Cancel
        </Button>
        <Button
          wrap
          variant="primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setFailed(!!(await onConfirm()));
            setBusy(false);
          }}
        >
          Delete Category
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
