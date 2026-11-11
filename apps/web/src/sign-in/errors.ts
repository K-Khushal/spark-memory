/** A Better Auth client error, or one of ours (status 0). */
type SignInError = { status?: number; code?: string };

/** What to tell the person, in Spark's voice. Never echoes server text. */
export function errorMessage(error: unknown): string {
  const { status, code } = (error ?? {}) as SignInError;
  if (status === 429) return "Too many tries. Wait a minute, then try again.";
  switch (code) {
    case "INVALID_OTP":
      return "That code is wrong. Check it and try again.";
    case "OTP_EXPIRED":
      return "That code has expired. Send a new one.";
    case "TOO_MANY_ATTEMPTS":
      return "Too many wrong tries. Send a new code.";
    case "INVALID_EMAIL":
      return "Enter a valid email.";
    case "TURNSTILE":
    case "VERIFICATION_FAILED":
    case "MISSING_RESPONSE":
      return "Spark could not check this browser. Reload and try again.";
    case "ACCOUNT_DELETING":
      return "This account is being deleted.";
    case "SOCIAL":
      return "That sign-in did not finish. Try again.";
  }
  if (!status) return "Spark is unreachable. Check your connection.";
  return "Something went wrong. Try again.";
}
