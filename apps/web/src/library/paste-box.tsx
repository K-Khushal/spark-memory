import { restoreLibraryFocus } from "./focus";
import { useRef, useState, type FormEvent } from "react";
import { PaperclipIcon } from "lucide-react";
import { FREE_ALLOWANCE, IMAGE_TYPES, PDF_TYPE } from "@spark/core";
import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  Kbd,
  Textarea,
} from "@spark/ui";
import { MOD } from "./shortcuts";

const ACCEPT = [
  ...IMAGE_TYPES,
  PDF_TYPE,
  ".pdf",
  "image/heic",
  "image/heif",
  ".heic",
  ".heif",
].join(",");

/** The paste box: Capture for touch and pointer, with an optional Capture note. */
export function PasteBox({
  open,
  onOpenChange,
  onCapture,
  onFiles,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** False when nothing was Captured, so the box keeps its text. */
  onCapture: (text: string, captureNote: string) => boolean;
  onFiles: (files: File[]) => void;
}) {
  const picker = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [note, setNote] = useState("");

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (!onCapture(text, note)) return;
    setText("");
    setNote("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onCloseAutoFocus={restoreLibraryFocus}
        aria-describedby={undefined}
        className="max-h-[90dvh] max-w-xl overflow-y-auto p-4 sm:p-6"
      >
        <form onSubmit={submit} className="flex flex-col gap-3">
          <DialogTitle>Capture</DialogTitle>
          <Textarea
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
            }}
            onPaste={(e) => {
              const files = [...e.clipboardData.files];
              // Copied text from Office apps carries a picture too: text wins.
              if (!files.length || e.clipboardData.getData("text/plain").trim())
                return;
              e.preventDefault();
              onFiles(files);
            }}
            placeholder="Paste or Type"
            aria-label="Text"
            dir="auto"
            className="max-h-[50dvh] min-h-32"
          />
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={FREE_ALLOWANCE.captureNoteMaxChars}
            placeholder="Capture Note"
            aria-label="Capture Note"
            dir="auto"
            className="h-11 min-w-0 rounded-control bg-sunken px-3 text-[1rem] text-ink outline-none placeholder:text-ink-muted focus-visible:outline-2 focus-visible:outline-ring"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button
              type="button"
              variant="quiet"
              className="h-auto min-h-10 max-w-full px-2 whitespace-normal"
              onClick={() => picker.current?.click()}
            >
              <PaperclipIcon aria-hidden /> Choose Files
            </Button>
            <input
              ref={picker}
              type="file"
              accept={ACCEPT}
              multiple
              hidden
              aria-label="Choose Files"
              onChange={(e) => {
                const files = [...(e.target.files ?? [])];
                e.target.value = "";
                if (files.length) onFiles(files);
              }}
            />
            <Button
              type="submit"
              variant="primary"
              className="ml-auto h-10"
              disabled={!text.trim()}
            >
              Capture
              <Kbd className="hidden border-transparent bg-canvas/15 text-canvas sm:inline-flex">
                {MOD}↵
              </Kbd>
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
