/** Roles a person can hold. Granted by configuration, never stored, never set by an API. */
export const ROLES = ["admin"] as const;
export type Role = (typeof ROLES)[number];

/**
 * Addresses in a comma-separated ADMIN_EMAILS secret. Empty or unset means
 * nobody. Comparison ignores case and surrounding spaces.
 */
export function adminEmails(list: string | undefined): ReadonlySet<string> {
  if (!list) return new Set();
  return new Set(
    list
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  );
}

/** The roles `email` holds. Today the only grant is the admin list. */
export function rolesFor(email: string, adminList: string | undefined): Role[] {
  return adminEmails(adminList).has(email.trim().toLowerCase())
    ? ["admin"]
    : [];
}

export function isAdmin(email: string, adminList: string | undefined): boolean {
  return rolesFor(email, adminList).includes("admin");
}

/**
 * Admin is the allowlist plus a verified address. An unverified session for
 * an allowlisted address is not an admin: the address has not been proved.
 */
export function isVerifiedAdmin(
  user: { email: string; emailVerified: boolean },
  adminList: string | undefined
): boolean {
  return user.emailVerified === true && isAdmin(user.email, adminList);
}
