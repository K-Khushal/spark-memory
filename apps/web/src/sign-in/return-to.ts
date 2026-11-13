/** OAuth resumes only at our own authorization endpoint. */
export function signInReturnTo(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.startsWith("/api/oauth/authorize?"))
    return undefined;
  const url = new URL(value, "https://spark.invalid");
  return url.origin === "https://spark.invalid" &&
    url.pathname === "/api/oauth/authorize"
    ? value
    : undefined;
}
