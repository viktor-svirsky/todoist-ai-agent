export interface ValidationError {
  field: string;
  message: string;
}

export function isPrivateHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (lower === "localhost") return true;

  // IPv6 private/reserved ranges (must contain ":" to avoid matching regular hostnames)
  if (lower === "::1" || lower === "::") return true;                    // loopback / unspecified
  if (/^fe[89ab][0-9a-f]:/.test(lower)) return true;                       // link-local (fe80::/10)
  if (lower.includes(":") && (lower.startsWith("fc") || lower.startsWith("fd"))) return true; // unique local (fc00::/7)
  if (lower.startsWith("::ffff:")) {                                     // IPv4-mapped IPv6
    return isPrivateHostname(lower.slice(7));
  }

  // IPv4 private/reserved ranges
  const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const [a, b] = [Number(ipv4Match[1]), Number(ipv4Match[2])];
    if (a === 0) return true;                          // 0.0.0.0/8
    if (a === 10) return true;                         // 10.0.0.0/8
    if (a === 127) return true;                        // 127.0.0.0/8
    if (a === 169 && b === 254) return true;           // 169.254.0.0/16 (link-local / AWS metadata)
    if (a === 172 && b >= 16 && b <= 31) return true;  // 172.16.0.0/12
    if (a === 192 && b === 168) return true;           // 192.168.0.0/16
  }

  // Cloud metadata hostnames
  const blocked = ["metadata.google.internal", "metadata.goog"];
  if (blocked.includes(lower)) return true;

  return false;
}

function hasControlChars(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

export function validateSettings(
  updates: Record<string, unknown>
): ValidationError[] {
  const errors: ValidationError[] = [];

  if ("max_messages" in updates) {
    const v = updates.max_messages;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 100) {
      errors.push({ field: "max_messages", message: "Must be an integer between 1 and 100" });
    }
  }

  if ("trigger_word" in updates) {
    const v = updates.trigger_word;
    if (typeof v !== "string" || v.length < 1 || v.length > 50) {
      errors.push({ field: "trigger_word", message: "Must be a string between 1 and 50 characters" });
    } else if (/[<>&]/.test(v) || hasControlChars(v)) {
      errors.push({ field: "trigger_word", message: "Must not contain <, >, &, or control characters" });
    }
  }

  if ("custom_ai_base_url" in updates && updates.custom_ai_base_url != null) {
    const v = updates.custom_ai_base_url;
    if (typeof v !== "string") {
      errors.push({ field: "custom_ai_base_url", message: "Must be a string" });
    } else {
      try {
        const url = new URL(v);
        if (url.protocol !== "https:") {
          errors.push({ field: "custom_ai_base_url", message: "Must use HTTPS protocol" });
        } else if (isPrivateHostname(url.hostname)) {
          errors.push({ field: "custom_ai_base_url", message: "Private or internal URLs are not allowed" });
        }
      } catch {
        errors.push({ field: "custom_ai_base_url", message: "Must be a valid URL" });
      }
    }
  }

  if ("custom_ai_model" in updates && updates.custom_ai_model != null) {
    const v = updates.custom_ai_model;
    if (typeof v !== "string" || v.length > 100) {
      errors.push({ field: "custom_ai_model", message: "Must be a string of at most 100 characters" });
    }
  }

  if ("custom_ai_api_key" in updates && updates.custom_ai_api_key != null) {
    const v = updates.custom_ai_api_key;
    if (typeof v !== "string" || v.length > 500) {
      errors.push({ field: "custom_ai_api_key", message: "Must be a string of at most 500 characters" });
    }
  }

  if ("custom_brave_key" in updates && updates.custom_brave_key != null) {
    const v = updates.custom_brave_key;
    if (typeof v !== "string" || v.length > 500) {
      errors.push({ field: "custom_brave_key", message: "Must be a string of at most 500 characters" });
    }
  }

  if ("custom_prompt" in updates && updates.custom_prompt != null) {
    const v = updates.custom_prompt;
    if (typeof v !== "string" || v.length > 2000) {
      errors.push({ field: "custom_prompt", message: "Must be a string of at most 2000 characters" });
    }
  }

  return errors;
}

/** Extract image URLs from markdown ![alt](url) syntax.
 *  Handles URLs with balanced parentheses (e.g. `path(1).png`). */
export function extractMarkdownImageUrls(text: string): string[] {
  const regex = /!\[[^\]]*\]\(([^()\s]+(?:\([^)]*\)[^()\s]*)*)\)/g;
  const urls: string[] = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    urls.push(match[1]);
  }
  return urls;
}

/** Guess media type from a URL's file extension. */
export function guessMediaType(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const ext = pathname.split(".").pop()?.toLowerCase();
    if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
    if (ext === "png") return "image/png";
    if (ext === "gif") return "image/gif";
    if (ext === "webp") return "image/webp";
  } catch { /* ignore */ }
  return "image/png";
}

const ALLOWED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

export function sanitizeImageMediaType(fileType: string | undefined): string {
  if (fileType && ALLOWED_IMAGE_TYPES.has(fileType)) return fileType;
  return "image/png";
}
