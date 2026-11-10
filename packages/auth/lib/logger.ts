import type { BetterAuthOptions } from "better-auth";
import { databaseFailure } from "@spark/db";

// Better Auth's default logger prints errors with their arguments, and a
// failed query's message carries its parameters (session tokens, addresses).
// Here a message is kept only if it is plain words, arguments never are, and
// a database failure is named by its category alone.

/** Letters, spaces and light punctuation: no digits, colons, quotes or `@`. */
const PLAIN = /^[A-Za-z][A-Za-z_ ,.()'-]{0,119}$/;
/** A long run of letters could still be a token. */
const LONG_WORD = /[A-Za-z_]{24,}/;

const plain = (text: unknown) =>
  typeof text === "string" && PLAIN.test(text) && !LONG_WORD.test(text)
    ? text
    : "[redacted]";

const isError = (x: unknown) =>
  x instanceof Error || (typeof x === "object" && x !== null && "code" in x);

/** One log line for `message` and its arguments, safe to print. */
export function redact(message: unknown, args: unknown[] = []): string {
  const error = [message, ...args].find(isError);
  const text =
    message instanceof Error ? plain(message.message) : plain(message);
  return error ? `${text} (${databaseFailure(error)})` : text;
}

export const redactingLogger: NonNullable<BetterAuthOptions["logger"]> = {
  level: "warn",
  log: (level, message, ...args) => {
    const line = `auth ${level}: ${redact(message, args)}`;
    if (level === "error") console.error(line);
    else console.warn(line);
  },
};
