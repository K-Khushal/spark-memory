import { useEffect, useState } from "react";
import { toast } from "@spark/ui";
import { api } from "../api";

export type DeviceSession = {
  handle: string;
  device: string;
  lastActiveAt: string;
  current: boolean;
};

export type LibraryExport =
  | { state: "building" | "failed"; requestedAt: string }
  | { state: "ready"; requestedAt: string; expiresAt: string; bytes: number }
  | null;

/** Same origin: the server redirects to a freshly signed storage URL. */
export const EXPORT_DOWNLOAD_URL = "/api/account/export/download";

const account = api.api.account;
/** While an export builds, Settings asks after it from 3 s, backing off to 30 s. */
const POLL = { first: 3000, max: 30_000 };

async function fetchSessions(): Promise<DeviceSession[] | "failed"> {
  const res = await account.sessions.$get().catch(() => undefined);
  return res?.ok ? (await res.json()).sessions : "failed";
}

async function fetchExport(): Promise<LibraryExport | "failed"> {
  const res = await account.export.$get().catch(() => undefined);
  return res?.ok ? ((await res.json()).export as LibraryExport) : "failed";
}

/** A toast for an action that did not finish, with Try Again. */
const didNotFinish = (message: string, retry: () => void) =>
  toast(message, { action: { label: "Try Again", onClick: retry } });

/**
 * The account API for Settings: sessions and the latest export, loaded
 * when the screen opens or comes back into view (the export polled while it
 * builds), and the actions on them. An action that fails says so in a
 * toast and leaves the screen as it was.
 */
export function useAccount() {
  const [sessions, setSessions] = useState<DeviceSession[] | "failed">();
  const [current, setCurrent] = useState<LibraryExport | "failed">();
  const [pending, setPending] = useState<"export" | "everywhere">();
  const [version, setVersion] = useState(0);
  const reload = () => setVersion((v) => v + 1);

  useEffect(() => {
    let live = true;
    void fetchSessions().then((s) => live && setSessions(s));
    void fetchExport().then((e) => live && setCurrent(e));
    return () => {
      live = false;
    };
  }, [version]);

  // Back from another tab: an export may have finished or expired meanwhile.
  useEffect(() => {
    const onShow = () => {
      if (document.visibilityState === "visible") {
        void fetchExport().then((e) => e !== "failed" && setCurrent(e));
      }
    };
    document.addEventListener("visibilitychange", onShow);
    return () => document.removeEventListener("visibilitychange", onShow);
  }, []);

  const building = current !== "failed" && current?.state === "building";
  useEffect(() => {
    if (!building) return;
    let delay = POLL.first;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      // A failed poll is not a failed export: ask again later.
      const next = await fetchExport();
      if (next !== "failed") setCurrent(next);
      delay = Math.min(delay * 1.5, POLL.max);
      timer = setTimeout(() => void tick(), delay);
    };
    timer = setTimeout(() => void tick(), delay);
    return () => clearTimeout(timer);
  }, [building]);

  async function revoke(session: DeviceSession) {
    const res = await account.sessions[":handle"]
      .$delete({ param: { handle: session.handle } })
      .catch(() => undefined);
    const status: number | undefined = res?.status;
    if (status !== 204 && status !== 404) {
      didNotFinish("Sign Out Did Not Finish", () => void revoke(session));
      return false;
    }
    setSessions((all) =>
      Array.isArray(all) ? all.filter((s) => s !== session) : all
    );
    return true;
  }

  /** True once every device, this one included, is signed out. */
  async function signOutEverywhere(): Promise<boolean> {
    setPending("everywhere");
    const res = await account["sign-out-everywhere"]
      .$post()
      .catch(() => undefined);
    setPending(undefined);
    if (!res?.ok) {
      didNotFinish("Sign Out Did Not Finish", () => void signOutEverywhere());
    }
    return !!res?.ok;
  }

  async function startExport() {
    setPending("export");
    const res = await account.export.$post().catch(() => undefined);
    setPending(undefined);
    if (res?.status === 202) {
      setCurrent((await res.json()).export as LibraryExport);
      return;
    }
    if (res?.status === 409) {
      const { error } = (await res.json()) as { error: string };
      // "busy": already building (another tab); show it.
      if (error === "too_soon") toast("Export Again in an Hour");
      reload();
      return;
    }
    didNotFinish("Export Did Not Start", () => void startExport());
  }

  /** True once the account is being deleted (and this device signed out). */
  async function deleteAccount(email: string) {
    const res = await account
      .$delete({ json: { email } })
      .catch(() => undefined);
    if (!res?.ok) toast("Delete Did Not Finish");
    return !!res?.ok;
  }

  return {
    sessions,
    export: current,
    pending,
    reload,
    revoke,
    signOutEverywhere,
    startExport,
    deleteAccount,
  };
}
