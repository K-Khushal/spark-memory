import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { browser } from "wxt/browser";
import { grantCapture, type PermissionCapture } from "../../lib/permission";
import "../../lib/theme";
import "@spark/ui/fonts.css";
import "../popup/style.css";

document.body.dataset.permission = "true";

function Permission() {
  const [job, setJob] = useState<PermissionCapture>();
  const [label, setLabel] = useState("Grant Access");
  const [busy, setBusy] = useState(false);
  const grant = useRef<HTMLButtonElement>(null);
  // The one thing this page is for: Enter grants, with the focus ring showing.
  useEffect(() => {
    if (job) grant.current?.focus();
  }, [job]);
  useEffect(() => {
    void browser.storage.session
      .get<{ permissionCapture?: PermissionCapture }>("permissionCapture")
      .then(({ permissionCapture: pending }) => {
        if (
          pending?.id === location.hash.slice(1) &&
          pending.expiresAt > Date.now()
        )
          setJob(pending);
        else setLabel("Try Again");
      })
      .catch(() => setLabel("Try Again"));
  }, []);
  return (
    <main>
      <header>Spark</header>
      <button
        ref={grant}
        disabled={!job || busy}
        onClick={() => {
          if (!job) return;
          // Do not put an await before this: browsers require the actual click stack.
          const granting = grantCapture(job);
          setBusy(true);
          void granting
            .then((result) => {
              if (result.state !== "error") window.close();
              else setLabel(result.label ?? "Try Again");
            })
            .finally(() => setBusy(false));
        }}
      >
        {busy ? "Capturing" : "Grant Access"}
      </button>
      {label !== "Grant Access" && <p role="status">{label}</p>}
      <button
        className="quiet"
        onClick={() => {
          void browser.runtime
            .sendMessage({
              type: "permission-cancel",
              id: location.hash.slice(1),
            })
            .catch(() => {})
            .finally(() => window.close());
        }}
      >
        Cancel
      </button>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Permission />);
