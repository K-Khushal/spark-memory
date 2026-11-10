import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

function Popup() {
  return (
    <main style={{ padding: 16, minWidth: 280, fontFamily: "system-ui" }}>
      <strong>Spark</strong>
      <p>Saving from the browser arrives with the extension tickets.</p>
    </main>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

createRoot(root).render(
  <StrictMode>
    <Popup />
  </StrictMode>
);
