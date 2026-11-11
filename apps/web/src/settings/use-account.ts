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
  | {
      state: "ready";
      requestedAt: string;
      url: string;
      expiresAt: string;
      bytes: number;
    }
  | null;

const account = api.api.account;
/** How often Settings asks after an export being built. */
const EXPORT_POLL_MS = 3000;

async function fetchSessions(): Promise<DeviceSession[] | "failed"> {
  const res = await account.sessions.$get().catch(() => undefined);
  return res?.ok ? (await res.json()).sessions : "failed";
}

async function fetchExport(): Promise<LibraryExport | "failed"> {
  const res = await account.export.$get().catch(() => undefined);
  return res?.ok ? ((await res.json()).export as LibraryExport) : "failed";
}

/**
 * The account API for Settings: sessions and the latest export, loaded
 * once (the export polled while it builds), and the actions on them. Every
 * action that fails says so in a toast and leaves the screen as it was.
 */
export function useAccount() {
  const [sessions, setSessions] = useState<DeviceSession[] | "failed">();
  const [current, setCurrent] = useState<LibraryExport | "failed">();

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

  const building = current !== "failed" && current?.state === "building";
  useEffect(() => {
    if (!building) return;
    const timer = setInterval(
      () => void fetchExport().then(setCurrent),
      EXPORT_POLL_MS
    );
    return () => clearInterval(timer);
  }, [building]);

  return {
    sessions,
    export: current,
    reload,

    async revoke(session: DeviceSession) {
      const res = await account.sessions[":handle"]
        .$delete({ param: { handle: session.handle } })
        .catch(() => undefined);
      const status: number | undefined = res?.status;
      if (status !== 204 && status !== 404) {
        toast("Sign Out Did Not Finish");
        return;
      }
      setSessions((all) =>
        Array.isArray(all) ? all.filter((s) => s !== session) : all
      );
    },

    /** True once every device, this one included, is signed out. */
    async signOutEverywhere() {
      const res = await account["sign-out-everywhere"]
        .$post()
        .catch(() => undefined);
      if (!res?.ok) toast("Sign Out Did Not Finish");
      return !!res?.ok;
    },

    async startExport() {
      const res = await account.export.$post().catch(() => undefined);
      if (res?.status === 202) {
        setCurrent((await res.json()).export as LibraryExport);
        return;
      }
      toast(
        res?.status === 409 ? "Export Again in an Hour" : "Export Did Not Start"
      );
      reload();
    },

    /** True once the account is being deleted (and this device signed out). */
    async deleteAccount(email: string) {
      const res = await account
        .$delete({ json: { email } })
        .catch(() => undefined);
      if (!res?.ok) toast("Delete Did Not Finish");
      return !!res?.ok;
    },
  };
}
