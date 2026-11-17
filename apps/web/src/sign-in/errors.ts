/** A Better Auth client error, or one of ours (status 0). */
type SignInError = { status?: number; code?: string };

/**
 * What to tell the person, in Spark's voice: one Title Case phrase, never a
 * sentence and never server text. The step's resend and retry controls sit
 * right beside it.
 */
export function errorMessage(error: unknown): string {
  const { status, code } = (error ?? {}) as SignInError;
  if (status === 429) return "Too Many Tries";
  switch (code) {
    case "INVALID_OTP":
      return "Wrong Code";
    case "OTP_EXPIRED":
      return "Code Expired";
    case "TOO_MANY_ATTEMPTS":
      return "Too Many Wrong Tries";
    case "INVALID_EMAIL":
      return "Invalid Email Address";
    case "TURNSTILE":
    case "VERIFICATION_FAILED":
    case "MISSING_RESPONSE":
      return "Browser Check Failed";
    case "ACCOUNT_DELETING":
      return "Account Being Deleted";
    case "SOCIAL":
      return "Sign In Did Not Finish";
  }
  if (!status) return "Spark Is Unreachable";
  return "Something Went Wrong";
}
