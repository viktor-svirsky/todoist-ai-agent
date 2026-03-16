import { AI_INDICATOR, ERROR_PREFIX, PROGRESS_INDICATOR } from "./constants.ts";
import type { TodoistComment } from "./types.ts";

export interface Message {
  role: "user" | "assistant";
  content: string;
}

/** Convert Todoist comments to AI conversation messages.
 *  - AI comments → assistant (strips the AI_INDICATOR prefix)
 *  - User comments → user (strips trigger word)
 *  - In-flight progress comments and error comments are skipped.
 */
export interface CommentsToMessagesResult {
  messages: Message[];
  commentIds: string[];
}

export function commentsToMessages(
  comments: TodoistComment[],
  triggerWord: string,
  progressCommentId: string
): CommentsToMessagesResult {
  const triggerRegex = new RegExp(
    triggerWord.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    "gi"
  );

  const messages: Message[] = [];
  const commentIds: string[] = [];

  for (const comment of comments) {
    if (comment.id === progressCommentId) continue;

    const content: string = comment.content ?? "";
    const hasImageAttachment = !!comment.file_attachment?.file_type?.startsWith("image/");
    if (!content.trim() && !hasImageAttachment) continue;

    if (content.startsWith(AI_INDICATOR)) {
      if (content === PROGRESS_INDICATOR) continue;
      const stripped = content.slice(AI_INDICATOR.length).replace(/^\n+/, "").trim();
      if (stripped) {
        messages.push({ role: "assistant", content: stripped });
        commentIds.push(comment.id);
      }
    } else if (content.startsWith(ERROR_PREFIX)) {
      continue;
    } else {
      const stripped = content.replace(triggerRegex, "").replace(/\s+/g, " ").trim();
      if (stripped || hasImageAttachment) {
        messages.push({ role: "user", content: stripped || "[image]" });
        commentIds.push(comment.id);
      }
    }
  }

  return { messages, commentIds };
}

/** Normalize an AI base URL: strip surrounding whitespace and trailing slash. */
export function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/$/, "");
}

/** Normalize a model name: strip surrounding whitespace from secrets. */
export function normalizeModel(model: string): string {
  return model.trim();
}
