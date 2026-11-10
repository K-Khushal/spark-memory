import { useEffect, useState } from "react";
import { api } from "./api";

type ApiStatus = "checking" | "up" | "down";

// Placeholder screen. The real Library arrives after the design-direction
// ticket picks a direction (DESIGN.md).
export function HomePage() {
  const [status, setStatus] = useState<ApiStatus>("checking");

  useEffect(() => {
    api.api.health
      .$get()
      .then(async (res) => setStatus((await res.json()).ok ? "up" : "down"))
      .catch(() => setStatus("down"));
  }, []);

  return (
    <main className="grid min-h-dvh place-items-center p-6 font-sans">
      <div className="text-center">
        <h1 className="text-3xl font-semibold tracking-tight">Spark</h1>
        <p className="mt-2 opacity-70">
          Save anything. Find it whenever you need it.
        </p>
        <p className="mt-6 text-sm opacity-50">API: {status}</p>
      </div>
    </main>
  );
}
