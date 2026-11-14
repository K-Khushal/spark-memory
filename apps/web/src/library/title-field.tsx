import type { KeyboardEvent, Ref } from "react";
import { cn } from "@spark/ui";

/**
 * Memory detail's Title field. A title is one line of meaning, but a long one
 * (or large text on a narrow screen) wraps and the field grows to show all of
 * it, instead of cutting it to "Des…". Enter adds no line break and pasted
 * ones become spaces, so it still reads as a single line.
 */
export function TitleField({
  value,
  onChange,
  maxLength,
  placeholder,
  className,
  ref,
}: {
  value: string;
  onChange: (value: string) => void;
  maxLength: number;
  placeholder: string;
  className?: string;
  ref?: Ref<HTMLTextAreaElement>;
}) {
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // ⌘/Ctrl Enter closes Memory detail, so it carries on to its handler.
    if (event.key === "Enter" && !event.metaKey && !event.ctrlKey)
      event.preventDefault();
  };
  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\s*\r?\n\s*/g, " "))}
      onKeyDown={onKeyDown}
      maxLength={maxLength}
      placeholder={placeholder}
      aria-label="Title"
      dir="auto"
      className={cn(
        "field-sizing-content min-w-0 shrink-0 resize-none rounded-chip bg-transparent py-2 font-display text-lg font-semibold break-words text-ink placeholder:text-ink-muted",
        className
      )}
    />
  );
}
