import { TodoistClient } from "./todoist.ts";
import { executePrompt, isAnthropicUrl } from "./ai.ts";
import { DEFAULT_AI_MODEL, DEFAULT_MAX_TOKENS } from "./constants.ts";
import { normalizeModel } from "./messages.ts";
import { createServiceClient } from "./supabase.ts";
import { decrypt, decryptIfPresent } from "./crypto.ts";
import { captureException } from "./sentry.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TodoistTask {
  id: string;
  content: string;
  description?: string;
  priority: number; // 1=normal, 4=urgent (Todoist convention)
  due?: { date: string; datetime?: string; string?: string; timezone?: string };
  labels: string[];
  project_id?: string;
}

export interface TodoistProject {
  id: string;
  name: string;
}

export interface DigestUser {
  id: string;
  todoist_token: string;
  custom_ai_base_url: string | null;
  custom_ai_api_key: string | null;
  custom_ai_model: string | null;
  custom_brave_key: string | null;
  custom_prompt: string | null;
  digest_enabled: boolean;
  digest_time: string;
  digest_timezone: string;
  digest_project_id: string | null;
  last_digest_at: string | null;
  is_disabled: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_TASKS_IN_PROMPT = 100;
const DIGEST_INDICATOR = "📋 **Daily Digest**";

// ---------------------------------------------------------------------------
// buildDigestPrompt
// ---------------------------------------------------------------------------

export function buildDigestPrompt(
  overdueTasks: TodoistTask[],
  todayTasks: TodoistTask[],
  upcomingTasks: TodoistTask[],
  projects: TodoistProject[],
  timezone: string,
  customPrompt?: string | null,
): { system: string; user: string } {
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: timezone,
  });

  const projectMap = new Map(projects.map((p) => [p.id, p.name]));

  const systemParts = [
    "You are an AI assistant embedded in Todoist, generating a daily digest.",
    "Produce a concise, actionable summary the user can scan quickly.",
    "Include: priority ranking, overdue alerts, time-blocking suggestions, and a brief motivational nudge.",
    "Format with markdown. Keep it under 1500 characters.",
    `Current date: ${dateStr}`,
    `User's timezone: ${timezone}`,
  ];
  if (customPrompt) {
    systemParts.push(`User's custom instructions:\n${customPrompt}`);
  }

  const totalTasks = overdueTasks.length + todayTasks.length + upcomingTasks.length;

  if (totalTasks === 0) {
    return {
      system: systemParts.join("\n\n"),
      user: "No tasks for today! Generate a short, encouraging message about having a clear schedule, and suggest the user could use this time for planning or personal goals.",
    };
  }

  const userParts: string[] = [];

  if (overdueTasks.length > 0) {
    userParts.push("## ⚠️ OVERDUE TASKS");
    userParts.push(
      ...formatTasks(overdueTasks.slice(0, MAX_TASKS_IN_PROMPT), projectMap),
    );
  }

  if (todayTasks.length > 0) {
    const sorted = [...todayTasks].sort((a, b) => b.priority - a.priority);
    userParts.push("## 📌 TODAY'S TASKS");
    userParts.push(
      ...formatTasks(sorted.slice(0, MAX_TASKS_IN_PROMPT), projectMap),
    );
  }

  if (upcomingTasks.length > 0) {
    const grouped = groupByDate(upcomingTasks);
    userParts.push("## 📅 UPCOMING (next 7 days)");
    for (const [date, tasks] of grouped) {
      userParts.push(`\n### ${date}`);
      userParts.push(
        ...formatTasks(tasks.slice(0, MAX_TASKS_IN_PROMPT), projectMap),
      );
    }
  }

  // Truncate if total is too large
  let userContent = userParts.join("\n");
  if (userContent.length > 8000) {
    userContent = userContent.slice(0, 8000) + "\n\n...(truncated)";
  }

  return {
    system: systemParts.join("\n\n"),
    user: userContent,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function priorityLabel(p: number): string {
  switch (p) {
    case 4: return "🔴 P1";
    case 3: return "🟠 P2";
    case 2: return "🟡 P3";
    default: return "⚪ P4";
  }
}

function formatTasks(
  tasks: TodoistTask[],
  projectMap: Map<string, string>,
): string[] {
  return tasks.map((t) => {
    const parts = [`- ${priorityLabel(t.priority)} **${t.content}**`];
    if (t.project_id && projectMap.has(t.project_id)) {
      parts.push(`[${projectMap.get(t.project_id)}]`);
    }
    if (t.labels.length > 0) {
      parts.push(`(${t.labels.join(", ")})`);
    }
    if (t.due?.date) {
      parts.push(`— due ${t.due.date}`);
    }
    return parts.join(" ");
  });
}

function groupByDate(tasks: TodoistTask[]): Map<string, TodoistTask[]> {
  const map = new Map<string, TodoistTask[]>();
  for (const task of tasks) {
    const date = task.due?.date ?? "No date";
    const list = map.get(date) ?? [];
    list.push(task);
    map.set(date, list);
  }
  return map;
}

// ---------------------------------------------------------------------------
// processDigestForUser
// ---------------------------------------------------------------------------

export async function processDigestForUser(
  user: DigestUser,
): Promise<boolean> {
  if (!user.digest_enabled || user.is_disabled) {
    return false;
  }

  const todoist = new TodoistClient(user.todoist_token);

  // Fetch tasks and projects in parallel
  let overdueTasks: TodoistTask[];
  let todayTasks: TodoistTask[];
  let upcomingTasks: TodoistTask[];
  let projects: TodoistProject[];

  try {
    [overdueTasks, todayTasks, upcomingTasks, projects] = await Promise.all([
      todoist.getTasks("overdue"),
      todoist.getTasks("today"),
      todoist.getTasks("next 7 days & !today & !overdue"),
      todoist.getProjects(),
    ]);
  } catch (error) {
    console.error("Failed to fetch Todoist data for digest", {
      userId: user.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }

  // Build prompt
  const { system, user: userContent } = buildDigestPrompt(
    overdueTasks,
    todayTasks,
    upcomingTasks,
    projects,
    user.digest_timezone,
    user.custom_prompt,
  );

  // Build AI config
  const aiConfig = {
    baseUrl: (
      user.custom_ai_base_url ||
      Deno.env.get("DEFAULT_AI_BASE_URL") ||
      "https://api.anthropic.com/v1"
    ).trim().replace(/\/$/, ""),
    apiKey:
      user.custom_ai_api_key ||
      Deno.env.get("DEFAULT_AI_API_KEY") ||
      "",
    model: normalizeModel(
      user.custom_ai_model ||
      Deno.env.get("DEFAULT_AI_MODEL") ||
      DEFAULT_AI_MODEL,
    ),
    timeoutMs: 120_000,
    braveApiKey: undefined, // No web search for digests
  };

  // Call AI
  let response: string;
  try {
    const messages = [
      { role: "system", content: system },
      { role: "user", content: userContent },
    ];
    response = await executePrompt(messages, aiConfig);
  } catch (error) {
    console.error("AI API failed for digest", {
      userId: user.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }

  // Post digest to Todoist
  try {
    const digestContent = `${DIGEST_INDICATOR}\n\n${response}`;
    if (user.digest_project_id) {
      // Create a task in the specified project
      await todoist.createTask(digestContent, user.digest_project_id);
    } else {
      // Create a task in Inbox (no project_id)
      await todoist.createTask(digestContent);
    }
  } catch (error) {
    console.error("Failed to post digest to Todoist", {
      userId: user.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }

  // Update last_digest_at
  try {
    const supabase = createServiceClient();
    await supabase
      .from("users_config")
      .update({ last_digest_at: new Date().toISOString() })
      .eq("id", user.id);
  } catch (error) {
    console.error("Failed to update last_digest_at", {
      userId: user.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return true;
}

// ---------------------------------------------------------------------------
// Digest handler — processes all eligible users
// ---------------------------------------------------------------------------

export async function processDigestBatch(): Promise<{
  processed: number;
  skipped: number;
  errors: number;
}> {
  const supabase = createServiceClient();
  const stats = { processed: 0, skipped: 0, errors: 0 };

  // Fetch users who have digest enabled
  const { data: users, error } = await supabase
    .from("users_config")
    .select(
      "id, todoist_token, custom_ai_base_url, custom_ai_api_key, custom_ai_model, custom_brave_key, custom_prompt, digest_enabled, digest_time, digest_timezone, digest_project_id, last_digest_at, is_disabled",
    )
    .eq("digest_enabled", true)
    .eq("is_disabled", false);

  if (error || !users) {
    console.error("Failed to fetch digest users", error);
    return stats;
  }

  for (const user of users) {
    // Check if user's local time matches their digest_time
    if (!isDigestTimeNow(user.digest_time, user.digest_timezone)) {
      stats.skipped++;
      continue;
    }

    // Check idempotency — don't send duplicate digests within 20 hours
    if (user.last_digest_at) {
      const lastDigest = new Date(user.last_digest_at);
      const hoursSince = (Date.now() - lastDigest.getTime()) / (1000 * 60 * 60);
      if (hoursSince < 20) {
        stats.skipped++;
        continue;
      }
    }

    try {
      // Decrypt sensitive fields
      const decryptedUser: DigestUser = {
        ...user,
        todoist_token: await decrypt(user.todoist_token),
        custom_ai_api_key: await decryptIfPresent(user.custom_ai_api_key),
        custom_brave_key: await decryptIfPresent(user.custom_brave_key),
      };

      const success = await processDigestForUser(decryptedUser);
      if (success) {
        stats.processed++;
      } else {
        stats.skipped++;
      }
    } catch (error) {
      console.error("Digest processing failed for user", {
        userId: user.id,
        error: error instanceof Error ? error.message : String(error),
      });
      await captureException(error);
      stats.errors++;
    }
  }

  return stats;
}

// ---------------------------------------------------------------------------
// Time matching
// ---------------------------------------------------------------------------

export function isDigestTimeNow(
  digestTime: string,
  timezone: string,
): boolean {
  const now = new Date();
  let userHour: number;
  let userMinute: number;

  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    });
    const parts = formatter.formatToParts(now);
    userHour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
    userMinute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  } catch {
    return false; // Invalid timezone
  }

  const [targetHour, targetMinute] = digestTime.split(":").map(Number);

  // Match within a 30-minute window (to account for cron job frequency)
  const userMinutes = userHour * 60 + userMinute;
  const targetMinutes = targetHour * 60 + targetMinute;
  const diff = Math.abs(userMinutes - targetMinutes);

  return diff <= 30 || diff >= 1410; // 1410 = 24*60 - 30 (wrap around midnight)
}
