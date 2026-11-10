import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { motion } from "motion/react";
import { toast } from "@spark/ui";
import { EASING } from "@spark/ui/tokens";
import { LIBRARY, type FakeMemory } from "./fake-library";

/** The fake Library states break-ui needs: worst case, empty, 1,000 Memories. */
export const DATA_SETS = ["library", "empty", "huge"] as const;
export type DataSet = (typeof DATA_SETS)[number];

function seed(data: DataSet): LiveMemory[] {
  if (data === "empty") return [];
  if (data === "library") return LIBRARY;
  return Array.from({ length: 1000 }, (_, i) => {
    const base = LIBRARY[i % LIBRARY.length]!;
    return {
      ...base,
      id: `${base.id}-${i}`,
      daysAgo: base.daysAgo + Math.floor(i / LIBRARY.length) * 3,
    };
  });
}

export type LiveMemory = FakeMemory & { fresh?: boolean };

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

let counter = 0;

/** A path segment for display; malformed escapes (`100%`) stay as written. */
function decode(segment: string) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function fromClipboard(data: DataTransfer | null): LiveMemory | undefined {
  const id = `new-${++counter}`;
  const base = {
    id,
    daysAgo: 0,
    colours: [],
    categories: [],
    tags: [],
    signals: {},
    preservation: "preserved" as const,
    indexState: "indexing" as const,
    fresh: true,
  };
  const file = data?.files[0];
  if (file?.type.startsWith("image/")) {
    return {
      ...base,
      kind: "image",

      title: file.name || "Pasted image",
      aspect: 1.33,
      image: URL.createObjectURL(file),
    };
  }
  const text = data?.getData("text/plain").trim();
  if (!text) return undefined;
  if (/^https?:\/\/\S+$/.test(text)) {
    const url = new URL(text);
    return {
      ...base,
      kind: "link",

      title:
        url.pathname.length > 1
          ? decode(
              url.pathname.split("/").filter(Boolean).at(-1) ?? ""
            ).replace(/[-_]/g, " ")
          : url.hostname,
      source: url.hostname.replace(/^www\./, ""),
      aspect: 0.8,
    };
  }
  return {
    ...base,
    kind: "text",

    title: text.split("\n")[0]!.slice(0, 80),
    excerpt: text.slice(0, 280),
    aspect: 1.2,
  };
}

/**
 * The prototype Library: optimistic Capture with Undo (⌘V anywhere outside a
 * text field, or the Capture button), and Index state changing live.
 */
export function useLibrary(data: DataSet) {
  const [memories, setMemories] = useState<LiveMemory[]>(() => seed(data));
  const timers = useRef<number[]>([]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const capture = useCallback((memory: LiveMemory) => {
    setMemories((all) => [memory, ...all]);
    toast("Captured", {
      description: memory.title,
      action: {
        label: "Undo",
        onClick: () =>
          setMemories((all) => all.filter((x) => x.id !== memory.id)),
      },
    });
    timers.current.push(
      window.setTimeout(
        () =>
          setMemories((all) =>
            all.map((x) =>
              x.id === memory.id
                ? { ...x, indexState: "searchable", fresh: false }
                : x
            )
          ),
        2600
      )
    );
  }, []);

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if (isTyping(event.target)) return;
      const memory = fromClipboard(event.clipboardData);
      if (memory) {
        event.preventDefault();
        capture(memory);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [capture]);

  /** For pointer and touch: Capture whatever the clipboard holds, or a sample link. */
  const captureFromButton = useCallback(async () => {
    let text = "";
    try {
      text = await navigator.clipboard.readText();
    } catch {
      // Clipboard access refused: fall back to a sample.
    }
    const data = new DataTransfer();
    data.setData(
      "text/plain",
      text ||
        "https://www.smashingmagazine.com/2026/11/designing-calm-interfaces"
    );
    const memory = fromClipboard(data);
    if (memory) capture(memory);
  }, [capture]);

  const retry = useCallback((id: string) => {
    setMemories((all) =>
      all.map((x) => (x.id === id ? { ...x, indexState: "indexing" } : x))
    );
    timers.current.push(
      window.setTimeout(
        () =>
          setMemories((all) =>
            all.map((x) =>
              x.id === id ? { ...x, indexState: "searchable" } : x
            )
          ),
        2000
      )
    );
  }, []);

  return { memories, captureFromButton, retry };
}

/** ⌘K / Ctrl K anywhere, and `/` when not typing. */
export function useSearchShortcut(onSearch: () => void) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const k =
        event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey);
      if (k || (event.key === "/" && !isTyping(event.target))) {
        event.preventDefault();
        onSearch();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onSearch]);
}

/** The one authored moment: a new Capture fades and grows into place. */
export function Arrival({
  fresh,
  children,
}: {
  fresh?: boolean;
  children: ReactNode;
}) {
  if (!fresh) return <>{children}</>;
  return (
    <motion.div
      className="h-full w-full"
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.26, ease: EASING.out }}
    >
      {children}
    </motion.div>
  );
}
