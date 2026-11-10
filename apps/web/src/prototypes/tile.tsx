import { Chip } from "@spark/ui";
import { showsTitle, type Result } from "./fake-library";
import { IndexStateBadge, MemoryVisual } from "./memory-visual";
import { Arrival, type LiveMemory } from "./use-library";

const TITLE = 28;
const WHY = 30;

/** Height under a Tile's visual, so Masonry can place it without measuring. */
export function captionHeight(result: Result, withWhy: boolean) {
  return (showsTitle(result.memory) ? 0 : TITLE) + (withWhy ? WHY : 0);
}

/** One Memory in the wall: its visual, its title when the visual lacks one, and in search its first why-chip. */
export function Tile({
  result,
  height,
  query,
  withWhy,
  direct,
  onRetry,
}: {
  result: Result & { memory: LiveMemory };
  height: number;
  query: string;
  withWhy: boolean;
  direct: boolean;
  onRetry: (id: string) => void;
}) {
  const { memory, why } = result;
  return (
    <figure className="group h-full cursor-pointer">
      <div
        className="relative overflow-hidden rounded-tile transition-transform duration-[120ms] ease-out group-active:scale-[0.98] after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:shadow-[inset_0_0_0_1px_var(--edge)]"
        style={{ height }}
      >
        <Arrival fresh={memory.fresh}>
          <MemoryVisual memory={memory} query={query} />
        </Arrival>
        <IndexStateBadge
          memory={memory}
          onRetry={() => onRetry(memory.id)}
          className="absolute right-2 bottom-2"
        />
      </div>
      {!showsTitle(memory) && (
        <figcaption
          className="truncate px-0.5 pt-1.5 text-sm text-ink"
          dir="auto"
        >
          {memory.title}
        </figcaption>
      )}
      {withWhy && why[0] && (
        <Chip tone={direct ? "spark" : "why"} className="mt-1.5 max-w-full">
          <span>{why[0]}</span>
        </Chip>
      )}
    </figure>
  );
}
