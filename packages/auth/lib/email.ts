/** Sends one sign-in code. Never logs the address or the code. */
export type SignInCodeSender = (email: string, code: string) => Promise<void>;

const RESEND_URL = "https://api.resend.com/emails";

/**
 * Sends the code through Resend's REST API with plain fetch. One retry on a
 * network error or 5xx, under the same Idempotency-Key so it is never sent twice.
 */
export function resendSender({
  apiKey,
  from,
  fetch: send = fetch,
}: {
  apiKey: string;
  from: string;
  fetch?: typeof fetch;
}): SignInCodeSender {
  return async (email, code) => {
    const init: RequestInit = {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `sign-in-code/${crypto.randomUUID()}`,
      },
      body: JSON.stringify({
        from,
        to: [email],
        subject: `${code} is your Spark code`,
        text: `${code}\n\nThis code signs you in to Spark. It expires in 5 minutes.`,
      }),
    };
    let status = 0;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await send(RESEND_URL, init);
        if (res.ok) return;
        status = res.status;
        if (status < 500) break;
      } catch {
        status = 0;
      }
    }
    throw new Error(`Sign-in email not sent (Resend status ${status})`);
  };
}
