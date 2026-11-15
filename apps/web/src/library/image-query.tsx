import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Button, FilterChip, toast } from "@spark/ui";
import { ImagePlusIcon, XIcon } from "lucide-react";
import type { Memory } from "./use-library";
import { memoryName } from "./memory-tile";

export type ImageQuery =
  | { id: string; image: { data: string; mime: "image/jpeg" } }
  | { id: string; memory: string; name: string; thumbnailUrl?: string };

/** A transient query: decode locally, cap both dimensions, send no original file. */
export async function prepareQueryImage(file: File): Promise<ImageQuery> {
  if (
    !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
    file.size > 20 * 1024 * 1024
  )
    throw new Error("Use a JPEG, PNG or WebP Under 20 MB");
  const bitmap = await createImageBitmap(file);
  try {
    const ratio = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
    canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could Not Read Image");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL("image/jpeg", 0.85).split(",")[1]!;
    if (data.length > 1_398_104) throw new Error("Image Is Too Large");
    return { id: crypto.randomUUID(), image: { data, mime: "image/jpeg" } };
  } finally {
    bitmap.close();
  }
}

/** One decode state machine shared by both search surfaces. */
export function useImageQuery(initial?: ImageQuery) {
  const generation = useRef(0);
  const [state, setState] = useState<
    | { status: "idle" }
    | { status: "reading" }
    | { status: "ready"; value: ImageQuery }
  >(initial ? { status: "ready", value: initial } : { status: "idle" });
  useEffect(
    () => () => {
      generation.current++;
    },
    []
  );
  const change = (value: ImageQuery | undefined) => {
    generation.current++;
    setState(value ? { status: "ready", value } : { status: "idle" });
  };
  const choose = async (file?: File) => {
    if (!file) return;
    const own = ++generation.current;
    setState({ status: "reading" });
    try {
      const value = await prepareQueryImage(file);
      if (generation.current === own) setState({ status: "ready", value });
    } catch (error) {
      if (generation.current === own) {
        setState({ status: "idle" });
        toast.error(
          error instanceof Error ? error.message : "Could Not Read Image"
        );
      }
    }
  };
  return {
    value: state.status === "ready" ? state.value : undefined,
    busy: state.status === "reading",
    change,
    choose,
  };
}

export type ImageQueryProps = {
  value: ImageQuery | undefined;
  onChange: (value: ImageQuery | undefined) => void;
  onFile: (file?: File) => Promise<void>;
  busy: boolean;
};

/** Enter and the arrows act on the control, not on the palette's rows behind it. */
const keepKeys = (event: KeyboardEvent<HTMLElement>) => {
  if (["Enter", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key))
    event.stopPropagation();
};

/**
 * Search By Image for both search surfaces: paste and drop anywhere on it,
 * and the button that picks a file. With `children` (the ⌘K input) the
 * button is handed to the field's trailing slot, and the chip appears below
 * only once there is an image; without it (the wall's field) it is the
 * button alone.
 */
export function ImageQueryControls({
  value,
  onChange,
  children,
  onFile: choose,
  busy,
  showChip = true,
}: ImageQueryProps & {
  showChip?: boolean;
  /** Draws the search field, with the picker button for its trailing slot. */
  children?: (button: ReactNode) => ReactNode;
}) {
  const input = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);
  /** A picked file hands focus back to the field, so Enter searches by it. */
  const pick = (file?: File) =>
    choose(file).then(() =>
      root.current
        ?.querySelector<HTMLInputElement>("input:not([type=file])")
        ?.focus()
    );
  const button = (
    <div className="flex items-center" onKeyDown={keepKeys}>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        aria-label="Query Image File"
        hidden
        onChange={(event) => {
          void pick(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      <Button
        variant="quiet"
        size="icon"
        aria-label="Image Query"
        title="Image Query"
        aria-busy={busy}
        onClick={() => input.current?.click()}
      >
        <ImagePlusIcon aria-hidden />
      </Button>
    </div>
  );
  return (
    <div
      ref={root}
      onPaste={(event) => {
        const file = [...event.clipboardData.files][0];
        if (file) {
          event.preventDefault();
          event.stopPropagation();
          void choose(file);
        }
      }}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) event.preventDefault();
      }}
      onDrop={(event) => {
        if (event.dataTransfer.files.length) {
          event.preventDefault();
          event.stopPropagation();
          void choose(event.dataTransfer.files[0]);
        }
      }}
    >
      {children ? children(button) : button}
      {showChip && (value || busy) && (
        <div
          className="flex min-w-0 flex-wrap items-center gap-2 px-3 py-2"
          onKeyDown={keepKeys}
        >
          <QueryImageChip value={value} busy={busy} onChange={onChange} />
        </div>
      )}
    </div>
  );
}

/** The query image sits with the filter chips; removal cancels a pending decode too. */
export function QueryImageChip({
  value,
  busy,
  onChange,
}: Pick<ImageQueryProps, "value" | "busy" | "onChange">) {
  if (!value && !busy) return null;
  const name = value && "memory" in value ? value.name : "Query Image";
  const thumbnail =
    value &&
    ("image" in value
      ? `data:${value.image.mime};base64,${value.image.data}`
      : value.thumbnailUrl);
  return (
    <FilterChip
      aria-pressed
      aria-label="Remove Query Image"
      onClick={() => onChange(undefined)}
      className="max-w-full min-w-0"
    >
      {thumbnail && (
        <img
          className="size-6 shrink-0 rounded-chip object-cover"
          width={24}
          height={24}
          alt=""
          src={thumbnail}
        />
      )}
      <span className="min-w-0 truncate" dir="auto">
        {busy ? "Reading Image" : name}
      </span>
      <XIcon className="size-4" aria-hidden />
    </FilterChip>
  );
}

/**
 * More Like This names its source Memory the way a Library-picked image
 * does: a chip with its thumbnail and name, beside the filters, and
 * pressing it leaves the search.
 */
export function LikeSourceChip({
  memory,
  onClear,
}: {
  memory: Memory | undefined;
  onClear: () => void;
}) {
  if (!memory) return null;
  const thumbnail = memory.image?.thumbnailUrl;
  return (
    <FilterChip
      aria-pressed
      aria-label={`Remove More Like This, ${memoryName(memory) || "Memory"}`}
      onClick={onClear}
      className="max-w-full min-w-0"
    >
      {thumbnail && (
        <img
          className="size-6 shrink-0 rounded-chip object-cover"
          width={24}
          height={24}
          alt=""
          src={thumbnail}
        />
      )}
      <span className="min-w-0 truncate" dir="auto">
        {memoryName(memory) || "Memory"}
      </span>
      <XIcon className="size-4" aria-hidden />
    </FilterChip>
  );
}

/** Search with this Memory's stored Visual / Overview vectors, without uploading it again. */
export function SearchByImage({
  memory,
  onSelect,
  compact = false,
  className,
}: {
  memory: Memory;
  onSelect?: (memory: Memory) => void;
  compact?: boolean;
  className?: string;
}) {
  // Overview vectors alone do not make a Note or link an image query.
  const visual = ["image", "pdf", "video"].includes(memory.kind);
  if (!visual || !memory.hasVectors || memory.aiOptOut || !onSelect)
    return null;
  return (
    <Button
      variant="quiet"
      size="sm"
      className={className}
      onClick={() => onSelect(memory)}
    >
      <ImagePlusIcon aria-hidden />
      <span className={compact ? "max-sm:sr-only" : undefined}>
        Search By Image
      </span>
    </Button>
  );
}

export function memoryImageQuery(memory: Memory): ImageQuery {
  return {
    id: crypto.randomUUID(),
    memory: memory.id,
    name: memoryName(memory) || "Memory",
    ...(memory.image?.thumbnailUrl && {
      thumbnailUrl: memory.image.thumbnailUrl,
    }),
  };
}
