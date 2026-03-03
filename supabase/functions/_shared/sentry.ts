import * as Sentry from "npm:@sentry/deno";

let initialized = false;

function initSentry(): void {
  if (initialized) return;
  const dsn = getEnv("SENTRY_DSN");
  if (!dsn) return;
  initialized = true;
  Sentry.init({
    dsn,
    tracesSampleRate: 1.0,
    environment: getEnv("ENVIRONMENT") ?? "production",
  });
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
          "http.url": req.url,
        },
      },
      execute
    );
  };
}

export async function captureException(error: unknown): Promise<void> {
  if (!hasDsn()) return;
  Sentry.captureException(error);
  await Sentry.flush(2000);
}
