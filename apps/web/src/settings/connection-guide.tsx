import { useEffect, useRef, useState, type ReactNode } from "react";
import { CheckIcon, CopyIcon, ChevronDownIcon } from "lucide-react";
import {
  Menu,
  MenuTrigger,
  MenuContent,
  MenuCheckboxItem,
  CrossfadeIcon,
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
} from "@spark/ui";

/** The one URL every assistant connects to. */
export const serverUrl = () => `${window.location.origin}/api/mcp`;

/** A snippet and its Copy button. `label` names what is copied. */
function CopyBlock({ label, text }: { label: string; text: string }) {
  const code = useRef<HTMLElement>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // Clipboard blocked: select the text so the keyboard can copy it.
      if (code.current) getSelection()?.selectAllChildren(code.current);
    }
  };
  return (
    <div className="flex items-start gap-1 rounded-control bg-sunken">
      <code
        ref={code}
        tabIndex={0}
        className="min-w-0 flex-1 overflow-x-auto p-3 pb-4 font-mono text-xs/5 whitespace-pre"
      >
        {text}
      </code>
      <Button
        variant="quiet"
        size="icon-sm"
        className="m-1 shrink-0"
        aria-label={`Copy ${label}`}
        onClick={() => void copy()}
      >
        <CrossfadeIcon on={copied} from={<CopyIcon />} to={<CheckIcon />} />
      </Button>
      <span role="status" className="sr-only">
        {copied ? "Copied" : ""}
      </span>
    </div>
  );
}

function Guide({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-3">
      <ol className="flex flex-col gap-3 text-sm">{children}</ol>
    </section>
  );
}
const Step = ({ children }: { children: ReactNode }) => (
  <li className="flex flex-col gap-2">{children}</li>
);

/** Steps checked against Claude Code, Claude and Codex docs: docs/research/mcp-clients.md. */
export function ConnectionGuide({
  open,
  onOpenChange,
  onReturnFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReturnFocus?: () => void;
}) {
  const url = serverUrl();
  const [client, setClient] = useState("Claude Code");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onCloseAutoFocus={(event) => {
          if (onReturnFocus) {
            event.preventDefault();
            onReturnFocus();
          }
        }}
        presentation="sheet"
        className="flex max-h-[85dvh] max-w-xl flex-col overflow-hidden"
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle className="wrap-anywhere">Connection Guide</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-6 pb-4">
          <div className="flex flex-col gap-2 text-sm">
            <Menu>
              <MenuTrigger asChild>
                <Button
                  variant="outline"
                  aria-label={`Assistant: ${client}`}
                  className="min-h-11 w-full justify-between focus-visible:outline-offset-0"
                >
                  {client}
                  <ChevronDownIcon aria-hidden className="size-4" />
                </Button>
              </MenuTrigger>
              <MenuContent className="w-(--radix-dropdown-menu-trigger-width) min-w-(--radix-dropdown-menu-trigger-width)">
                {["Claude Code", "Claude Desktop", "Codex"].map((name) => (
                  <MenuCheckboxItem
                    key={name}
                    checked={client === name}
                    onCheckedChange={() => setClient(name)}
                  >
                    {name}
                  </MenuCheckboxItem>
                ))}
              </MenuContent>
            </Menu>
          </div>
          {client === "Claude Code" && (
            <Guide title="Claude Code">
              <Step>
                <CopyBlock
                  label="claude mcp add"
                  text={`claude mcp add --transport http spark ${url}`}
                />
              </Step>
              <Step>
                <span>Run this in Claude Code, choose spark and sign in.</span>
                <CopyBlock label="/mcp" text="/mcp" />
              </Step>
            </Guide>
          )}
          {client === "Claude Desktop" && (
            <Guide title="Claude Desktop">
              <Step>
                Open Customize, then Connectors. Choose Add, then Add Custom
                Connector.
              </Step>
              <Step>
                <CopyBlock label="Connector Name" text="Spark" />
                <CopyBlock label="Server URL" text={url} />
              </Step>
              <Step>Choose Add, then sign in to Spark.</Step>
            </Guide>
          )}
          {client === "Codex" && (
            <Guide title="Codex">
              <Step>
                <CopyBlock
                  label="codex mcp add"
                  text={`codex mcp add spark --url ${url}`}
                />
              </Step>
              <Step>
                <CopyBlock
                  label="codex mcp login"
                  text="codex mcp login spark"
                />
              </Step>
              <Step>
                <span>Or add this to ~/.codex/config.toml, then log in.</span>
                <CopyBlock
                  label="config.toml"
                  text={`[mcp_servers.spark]\nurl = "${url}"`}
                />
              </Step>
            </Guide>
          )}
        </DialogBody>
        <DialogFooter>
          <Button wrap variant="primary" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
