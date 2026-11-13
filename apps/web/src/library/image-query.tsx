import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, FilterChip, toast } from "@spark/ui";
import { ImagePlusIcon, XIcon } from "lucide-react";
import type { Memory } from "./use-library";
import { memoryName } from "./memory-tile";

export type ImageQuery =
  | { id: string; image: { data: string; mime: "image/jpeg" } }
  | { id: string; memory: string };

/** A transient query: decode locally, cap both dimensions, send no original file. */
export async function prepareQueryImage(file: File): Promise<ImageQuery> {
  if (
    !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
    file.size > 20 * 1024 * 1024
  )
    throw new Error("Choose A JPEG, PNG Or WebP Under 20 MB");
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
export function useImageQuery() {
  const generation = useRef(0);
  const [state, setState] = useState<
    | { status: "idle" }
    | { status: "reading" }
    | { status: "ready"; value: ImageQuery }
  >({ status: "idle" });
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

/** Shared by Search and its wall field. */
export function ImageQueryControls({
  value,
  onChange,
  memories,
  children,
  onFile: choose,
  busy,
  showChip = true,
}: ImageQueryProps & {
  showChip?: boolean;
  memories: Memory[];
  children?: ReactNode;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div
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
      {children}
      <div className="flex min-w-0 flex-wrap items-center gap-2 px-3 py-2">
        <input
          ref={input}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          aria-label="Query Image File"
          className="sr-only"
          tabIndex={-1}
          onChange={(event) => {
            void choose(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
        <Button
          variant="quiet"
          size="icon"
          aria-label="Search By Image"
          aria-busy={busy}
          onClick={() => input.current?.click()}
        >
          <ImagePlusIcon aria-hidden />
        </Button>
        <select
          aria-label="Choose From Library"
          value=""
          className="min-w-0 max-w-full min-h-9 rounded-control bg-surface text-[1rem] text-ink md:text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          onKeyDown={(event) => event.stopPropagation()}
          onChange={(event) => {
            if (event.target.value) {
              onChange({ id: crypto.randomUUID(), memory: event.target.value });
            }
          }}
        >
          <option value="">Choose From Library</option>
          {memories
            .filter((m) => m.hasVectors && !m.aiOptOut)
            .map((m) => (
              <option key={m.id} value={m.id}>
                {memoryName(m) || "Memory"}
              </option>
            ))}
        </select>
        {showChip && (
          <QueryImageChip value={value} busy={busy} onChange={onChange} />
        )}
      </div>
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
  return (
    <FilterChip
      aria-pressed
      aria-label="Remove Query Image"
      onClick={() => onChange(undefined)}
      className="max-w-full shrink-0"
    >
      {value && "image" in value && (
        <img
          className="size-6 shrink-0 rounded-chip object-cover"
          width={24}
          height={24}
          alt=""
          src={`data:${value.image.mime};base64,${value.image.data}`}
        />
      )}
      {busy ? "Reading Image" : "Query Image"}
      <XIcon className="size-4" aria-hidden />
    </FilterChip>
  );
}
