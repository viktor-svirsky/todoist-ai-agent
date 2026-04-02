import { createServiceClient } from "../_shared/supabase.ts";

const CACHE_SECONDS = 300; // 5 minutes

export async function statsHandler(req: Request): Promise<Response> {
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json", Allow: "GET" },
    });
  }

  try {
    const supabase = createServiceClient();
    const { count, error } = await supabase
      .from("users_config")
      .select("*", { count: "exact", head: true });

    if (error) {
      console.error(`Stats: database error: ${error.message}`);
      return new Response(JSON.stringify({ error: "Database error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ users: count ?? 0 }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": `public, max-age=${CACHE_SECONDS}`,
          "Access-Control-Allow-Origin": "https://todoist-ai-agent.pages.dev",
          "Access-Control-Allow-Methods": "GET",
        },
      },
    );
  } catch (err) {
    console.error(`Stats error: ${err instanceof Error ? err.message : "Unknown"}`);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
