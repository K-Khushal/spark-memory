import { FILTER_COLOURS } from "@spark/ui/tokens";
import { Button } from "@spark/ui";

/** No Category knowledge here: new filter groups can use the same controls. */
export function SearchFilters({
  onQuery,
  selected = [],
  compact = false,
  colour,
  onColour,
}: {
  onQuery: (query: string) => void;
  selected?: string[];
  compact?: boolean;
  colour: string | undefined;
  onColour: (hex: string | undefined) => void;
}) {
  return (
    <div
      className={
        compact ? "flex gap-5 overflow-x-auto pb-2" : "flex flex-col gap-5"
      }
      aria-label="Search Filters"
    >
      <div className={compact ? "flex shrink-0 gap-1" : "flex flex-wrap gap-1"}>
        {[
          ["Images", "images"],
          ["PDFs", "pdfs"],
          ["Links", "links"],
          ["Notes", "notes"],
          ["Videos", "videos"],
        ].map(([label, query]) => (
          <Button
            key={label}
            variant="quiet"
            size="sm"
            className="aria-pressed:bg-surface aria-pressed:text-ink aria-pressed:shadow-raised"
            aria-pressed={selected.includes(query!)}
            onClick={() => onQuery(query!)}
          >
            {label}
          </Button>
        ))}
      </div>
      <div className={compact ? "flex shrink-0 gap-2" : "flex flex-wrap gap-2"}>
        {FILTER_COLOURS.map((c) => (
          <button
            key={c.name}
            type="button"
            aria-label={c.name}
            title={c.name}
            aria-pressed={colour === c.hex}
            onClick={() => onColour(colour === c.hex ? undefined : c.hex)}
            className="size-6 shrink-0 rounded-full border border-line-strong aria-pressed:outline-2 aria-pressed:outline-offset-2 aria-pressed:outline-ring"
            style={{ backgroundColor: c.hex }}
          />
        ))}
      </div>
      <div className={compact ? "flex shrink-0 gap-1" : "flex flex-wrap gap-1"}>
        {[
          ["Instagram", "from instagram"],
          ["YouTube", "from youtube"],
          ["Last Month", "from last month"],
        ].map(([label, query]) => (
          <Button
            key={label}
            variant="quiet"
            size="sm"
            className="aria-pressed:bg-surface aria-pressed:text-ink aria-pressed:shadow-raised"
            aria-pressed={selected.includes(query!)}
            onClick={() => onQuery(query!)}
          >
            {label}
          </Button>
        ))}
      </div>
    </div>
  );
}
