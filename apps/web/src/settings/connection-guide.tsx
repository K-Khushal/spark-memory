import { motion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { Button, Dialog, DialogContent, DialogTitle } from "@spark/ui";

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
        <motion.span
          key={String(copied)}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.15 }}
        >
          {copied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
        </motion.span>
      </Button>
      <span role="status" className="sr-only">
        {copied ? "Copied" : ""}
      </span>
    </div>
  );
}

function Guide({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-sm font-medium">{title}</h3>
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
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const url = serverUrl();
  const [client, setClient] = useState("Claude Code");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[85dvh] max-w-xl flex-col gap-6 overflow-y-auto p-6"
        aria-describedby={undefined}
      >
        <DialogTitle className="pr-8">Connection Guide</DialogTitle>
        <label className="flex flex-col gap-2 text-sm">
          Assistant
          <select
            className="min-h-11 rounded-control border border-line-strong bg-canvas px-3 text-ink"
            value={client}
            onChange={(event) => setClient(event.target.value)}
          >
            {["Claude Code", "Claude Desktop", "Codex"].map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </label>
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
              <CopyBlock label="codex mcp login" text="codex mcp login spark" />
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
      </DialogContent>
    </Dialog>
  );
}
