import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useNavigate } from "@tanstack/react-router";
import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import { LoaderIcon } from "lucide-react";
import {
  Button,
  Input,
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@spark/ui";
import type { SocialProvider } from "@spark/auth";
import { authClient } from "../auth";
import { errorMessage } from "./errors";
import { GitHubMark, GoogleMark } from "./marks";

export type SignInOptions = {
  socialProviders: SocialProvider[];
  turnstileSiteKey: string;
};

const PROVIDERS = {
  google: { label: "Continue with Google", Mark: GoogleMark },
  github: { label: "Continue with GitHub", Mark: GitHubMark },
} as const;

const RESEND_AFTER_MS = 30_000;

/** Sign in and sign up are one flow: an email code or a social account. */
export function SignInPage({
  options,
  failed,
  returnTo,
}: {
  options: SignInOptions;
  failed?: boolean;
  returnTo?: string;
}) {
  const navigate = useNavigate();
  const turnstile = useRef<TurnstileInstance>(null);
  const [email, setEmail] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState<string>();
  const [error, setError] = useState<string | undefined>(
    failed ? errorMessage({ status: 0, code: "SOCIAL" }) : undefined
  );
  const [canResend, setCanResend] = useState(false);
  const resendTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const otpInput = useRef<HTMLInputElement>(null);
  useEffect(() => () => clearTimeout(resendTimer.current), []);

  /** Runs one request with a fresh Turnstile token; shows its error. */
  async function guarded(
    name: string,
    run: (token: string) => Promise<{ error: unknown }>
  ) {
    setPending(name);
    setError(undefined);
    try {
      const token = await turnstile.current
        ?.getResponsePromise(30_000)
        .catch(() => undefined);
      if (!token) {
        setError(errorMessage({ status: 0, code: "TURNSTILE" }));
        return false;
      }
      const { error } = await run(token).catch(() => ({
        error: { status: 0 },
      }));
      if (error) setError(errorMessage(error));
      return !error;
    } finally {
      turnstile.current?.reset();
      setPending(undefined);
    }
  }

  const sendCode = (name: string) =>
    guarded(name, (token) =>
      authClient.emailOtp.sendVerificationOtp({
        email,
        type: "sign-in",
        fetchOptions: { headers: { "x-captcha-response": token } },
      })
    ).then((sent) => {
      if (!sent) return;
      setStep("code");
      setCode("");
      setCanResend(false);
      clearTimeout(resendTimer.current);
      resendTimer.current = setTimeout(
        () => setCanResend(true),
        RESEND_AFTER_MS
      );
    });

  const social = (provider: SocialProvider) =>
    guarded(provider, (token) =>
      authClient.signIn.social({
        provider,
        callbackURL: returnTo ?? "/",
        errorCallbackURL:
          "/sign-in?failed=1" +
          (returnTo ? `&returnTo=${encodeURIComponent(returnTo)}` : ""),
        fetchOptions: { headers: { "x-captcha-response": token } },
      })
    );

  async function verify(otp: string) {
    setPending("verify");
    setError(undefined);
    const { error } = await authClient.signIn
      .emailOtp({
        email,
        otp,
        fetchOptions: { signal: AbortSignal.timeout(20_000) },
      })
      .catch(() => ({ error: { status: 0 } }));
    if (error) {
      setPending(undefined);
      setCode("");
      setError(errorMessage(error));
      requestAnimationFrame(() => otpInput.current?.focus());
      return;
    }
    if (returnTo) window.location.assign(returnTo);
    else await navigate({ to: "/" });
  }

  const onEmail = (event: FormEvent) => {
    event.preventDefault();
    if (!/^[^\s@]+@[^\s@]+$/.test(email)) {
      setError(errorMessage({ status: 400, code: "INVALID_EMAIL" }));
      return;
    }
    void sendCode("email");
  };

  return (
    <main className="grid min-h-dvh grid-cols-[minmax(0,1fr)] place-items-center bg-canvas px-4 py-12 max-sm:place-items-start max-sm:justify-items-center max-sm:pt-[20dvh]">
      <div className="flex w-full max-w-[22rem] flex-col gap-6">
        <Wordmark />
        {step === "email" ? (
          <>
            <Title>Sign In</Title>
            {options.socialProviders.length > 0 && (
              <div className="flex flex-col gap-2">
                {options.socialProviders.map((p) => {
                  const { label, Mark } = PROVIDERS[p];
                  return (
                    <Button
                      key={p}
                      variant="outline"
                      wrap
                      className="min-h-(--size-touch) text-base"
                      disabled={pending !== undefined}
                      onClick={() => void social(p)}
                    >
                      {pending === p ? <Spinner /> : <Mark />}
                      {label}
                    </Button>
                  );
                })}
                <hr className="mt-4 border-line" />
              </div>
            )}
            <form onSubmit={onEmail} className="flex flex-col gap-2" noValidate>
              <label htmlFor="email" className="sr-only">
                Email
              </label>
              <Input
                id="email"
                name="email"
                maxLength={254}
                type="email"
                inputMode="email"
                autoComplete="email"
                spellCheck={false}
                required
                placeholder="Email"
                value={email}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? "sign-in-error" : undefined}
                onChange={(e) => {
                  setEmail(e.target.value.trim());
                  setError(undefined);
                }}
                autoFocus
              />
              <ErrorLine error={error} />
              <Button
                type="submit"
                variant="primary"
                wrap
                className="min-h-(--size-touch) text-base"
                disabled={pending !== undefined}
              >
                {pending === "email" && <Spinner />}
                Continue with Email
              </Button>
            </form>
          </>
        ) : (
          <>
            <div className="flex flex-col gap-1">
              <Title>Check Your Email</Title>
              <p className="flex items-start gap-2 text-base text-ink-muted">
                <span className="min-w-0 [overflow-wrap:anywhere]" dir="auto">
                  {email}
                </span>
                {pending === "verify" && <Spinner />}
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <InputOTP
                maxLength={6}
                ref={otpInput}
                value={code}
                onChange={(value: string) => {
                  setCode(value);
                  setError(undefined);
                }}
                pasteTransformer={(text) => text.replace(/\D/g, "")}
                onComplete={(otp: string) => void verify(otp)}
                disabled={pending === "verify"}
                autoFocus
                inputMode="numeric"
                pattern="^[0-9]+$"
                autoComplete="one-time-code"
                aria-label="Code"
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? "sign-in-error" : undefined}
                containerClassName="w-full"
              >
                <InputOTPGroup className="w-full gap-2">
                  {Array.from({ length: 6 }, (_, i) => (
                    <InputOTPSlot
                      key={i}
                      index={i}
                      className="max-w-none"
                      aria-invalid={error ? true : undefined}
                    />
                  ))}
                </InputOTPGroup>
              </InputOTP>
              <ErrorLine error={error} />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button
                variant="quiet"
                wrap
                className="-ml-3"
                disabled={pending !== undefined}
                onClick={() => {
                  setStep("email");
                  setError(undefined);
                }}
              >
                Use Another Email
              </Button>
              <Button
                variant="quiet"
                wrap
                className="-mr-3"
                disabled={pending !== undefined || !canResend}
                onClick={() => void sendCode("resend")}
              >
                {pending === "resend" && <Spinner />}
                Resend Code
              </Button>
            </div>
          </>
        )}
        <Turnstile
          ref={turnstile}
          siteKey={options.turnstileSiteKey}
          options={{ appearance: "interaction-only", size: "flexible" }}
          // Its own 300px minimum is wider than a 320px screen's column.
          style={{ minWidth: "min(300px, 100%)" }}
        />
      </div>
    </main>
  );
}

/** The brand, in display type, above the step's heading. Not a heading. It says the name once: the heading does not repeat it. */
function Wordmark() {
  return <p className="font-display text-md font-semibold">Spark</p>;
}

function Title({ children }: { children: ReactNode }) {
  return <h1 className="font-display text-xl font-semibold">{children}</h1>;
}

/** The step's one error, right under its field. Read out when it appears. */
function ErrorLine({ error }: { error?: string }) {
  return (
    <p
      id="sign-in-error"
      role="alert"
      className="text-sm text-danger empty:hidden"
    >
      {error}
    </p>
  );
}

function Spinner() {
  return (
    <LoaderIcon
      className="size-4 shrink-0 animate-spin motion-reduce:animate-none"
      aria-hidden
    />
  );
}
