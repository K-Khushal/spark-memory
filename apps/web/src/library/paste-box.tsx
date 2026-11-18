import { restoreLibraryFocus } from "./focus";
import { useRef, useState, type FormEvent } from "react";
import { PaperclipIcon } from "lucide-react";
import { FREE_ALLOWANCE, IMAGE_TYPES, PDF_TYPE } from "@spark/core";
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
  Input,
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
        presentation="sheet"
        onCloseAutoFocus={restoreLibraryFocus}
        aria-describedby={undefined}
        className="flex max-h-[min(36rem,calc(100dvh-2rem))] max-w-md flex-col overflow-hidden"
      >
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <DialogHeader>
            <DialogTitle>Capture</DialogTitle>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-2">
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
                if (
                  !files.length ||
                  e.clipboardData.getData("text/plain").trim()
                )
                  return;
                e.preventDefault();
                onFiles(files);
              }}
              placeholder="Paste or Type"
              aria-label="Text"
              dir="auto"
              className="max-h-[50dvh] min-h-[min(calc(var(--spacing)*32),25dvh)]"
            />
            <Input
              size="sm"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={FREE_ALLOWANCE.captureNoteMaxChars}
              placeholder="Capture Note"
              aria-label="Capture Note"
              dir="auto"
              className="shrink-0"
            />
          </DialogBody>
          <DialogFooter className="justify-between">
            <Button
              type="button"
              variant="quiet"
              wrap
              className="min-h-10 px-2"
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
              wrap
              className="ml-auto min-h-10"
              disabled={!text.trim()}
            >
              Capture
              <Kbd className="hidden border-transparent bg-canvas/15 text-canvas sm:inline-flex">
                {MOD}↵
              </Kbd>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
