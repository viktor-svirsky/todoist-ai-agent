import * as Sentry from "@sentry/deno";

let initialized = false;

function initSentry(): void {
  if (initialized) return;
  const dsn = getEnv("SENTRY_DSN");
  if (!dsn) return;
  initialized = true;
  const environment = getEnv("ENVIRONMENT") ?? "production";
  Sentry.init({
    dsn,
    tracesSampleRate: getTracesSampleRate(environment),
    environment,
    // Disable fetch instrumentation — it patches globalThis.fetch and can
    // corrupt outgoing request bodies on Deno Deploy (Supabase Edge Functions).
    integrations: (defaults) =>
      defaults.filter((i) => i.name !== "Fetch"),
    // Don't inject sentry-trace / baggage headers into outgoing requests.
    tracePropagationTargets: [],
  });
}

export function getTracesSampleRate(environment: string): number {
  return environment === "production" ? 0.1 : 1.0;
}

function getEnv(key: string): string | undefined {
  try {
    return Deno.env.get(key);
  } catch {
    return undefined;
  }
}

function hasDsn(): boolean {
  return !!getEnv("SENTRY_DSN");
}

type Handler = (req: Request) => Promise<Response>;

export function withSentry(handler: Handler): Handler {
  initSentry();
  const active = hasDsn();
  return async (req: Request): Promise<Response> => {
    const execute = async (): Promise<Response> => {
      try {
        return await handler(req);
      } catch (error) {
        if (active) {
          Sentry.captureException(error);
          await Sentry.flush(2000);
        }
        return new Response(JSON.stringify({ error: "Internal server error" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
    };

    if (!active) return execute();

    return Sentry.startSpan(
      {
        name: `${req.method} ${new URL(req.url).pathname}`,
        op: "http.server",
        attributes: {
          "http.method": req.method,
          "http.url": new URL(req.url).pathname,
        },
      },
      execute
    );
  };
}

export async function captureException(error: unknown): Promise<void> {
  if (!hasDsn()) return;
  initSentry();
  Sentry.captureException(error);
  await Sentry.flush(2000);
}
