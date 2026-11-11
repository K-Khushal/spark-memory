/** The signed-in person a route guard needs. */
export type GateSession = {
  user: { id: string; email: string; name: string };
};

/**
 * The admin flag for one signed-in person. A failed read is not stored, so
 * the next visit tries again. Entering Admin asks again. A 403 from an
 * admin route drops the stored flag.
 */
export function createSessionGate(deps: {
  currentSession: () => Promise<GateSession | null>;
  /** True or false when `/api/me` answered. Null when it did not. */
  readAdmin: () => Promise<boolean | null>;
}) {
  let cached: { session: GateSession; admin: boolean } | null = null;

  return {
    clear() {
      cached = null;
    },
    noteStatus(status: number) {
      if (status === 403) cached = null;
    },
    async require(options?: { freshAdmin?: boolean }) {
      const session = await deps.currentSession();
      if (!session) {
        cached = null;
        return null;
      }
      const hit = cached !== null && cached.session.user.id === session.user.id;
      if (hit && cached && !options?.freshAdmin) return cached;
      const admin = await deps.readAdmin();
      if (admin === null) {
        cached = null;
        return { session, admin: false as const };
      }
      cached = { session, admin };
      return cached;
    },
  };
}
