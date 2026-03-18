import { isPrivateHostname } from "./validation.ts";
import {
  FETCH_URL_TIMEOUT_MS,
  MAX_FETCH_BYTES,
  MAX_FETCH_CONTENT_CHARS,
} from "./constants.ts";

/** Decode HTML entities to plain characters. */
function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** Strip HTML to plain text for AI consumption. */
export function htmlToText(html: string): string {
  let text = html;

  // Remove dangerous blocks in a loop to handle nested patterns like
  // <scr<script>...</script>ipt> which leave <script> after one pass.
  let prev;
  do {
    prev = text;
    text = text.replace(/<script[\s>][\s\S]*?<\/script\s*>/gi, "");
    text = text.replace(/<style[\s>][\s\S]*?<\/style\s*>/gi, "");
    text = text.replace(/<noscript[\s>][\s\S]*?<\/noscript\s*>/gi, "");
  } while (text !== prev);

  // Remove nav, header, footer (reduce boilerplate)
  text = text.replace(/<nav[\s>][\s\S]*?<\/nav\s*>/gi, "");
  text = text.replace(/<header[\s>][\s\S]*?<\/header\s*>/gi, "");
  text = text.replace(/<footer[\s>][\s\S]*?<\/footer\s*>/gi, "");

  // Line breaks
  text = text.replace(/<br\s*\/?>/gi, "\n");
  // Block-level closing tags → newline
  text = text.replace(/<\/(?:p|div|h[1-6]|li|tr|blockquote|section|article)\s*>/gi, "\n");

  // Strip all remaining tags
  text = text.replace(/<[^>]+>/g, "");

  // Decode entities AFTER tag stripping so decoded chars can't form new tags.
  // Decode &amp; last so &amp;lt; → &lt; does not then become <
  text = decodeEntities(text);

  // Collapse whitespace
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/\n[ \t]+/g, "\n");
  text = text.replace(/[ \t]+\n/g, "\n");
  text = text.replace(/\n{3,}/g, "\n\n");

  return text.trim();
}

/** Fetch a URL and extract its text content. */
export async function fetchUrl(url: string): Promise<string> {
  // Validate URL
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "Error: invalid URL.";
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return "Error: only HTTP and HTTPS URLs are supported.";
  }

  if (isPrivateHostname(parsed.hostname)) {
    return "Error: private or internal URLs are not allowed.";
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_URL_TIMEOUT_MS);

  try {
    const res = await fetch(parsed.href, {
      redirect: "error",
      signal: controller.signal,
      headers: {
        "User-Agent": "TodoistAIAgent/1.0",
        "Accept": "text/html,application/xhtml+xml,text/plain",
      },
    });

    if (!res.ok) {
      return `Error: HTTP ${res.status} fetching URL.`;
    }

    const contentType = res.headers.get("content-type") || "";
    const isHtml = contentType.includes("text/html") || contentType.includes("application/xhtml");
    const isText = contentType.includes("text/");

    if (!isHtml && !isText) {
      return `Cannot extract text from content type: ${contentType.split(";")[0].trim()}`;
    }

    // Check content-length header if available
    const contentLength = res.headers.get("content-length");
    if (contentLength && Number(contentLength) > MAX_FETCH_BYTES) {
      return `Error: page too large (${Math.round(Number(contentLength) / 1024 / 1024)}MB, limit ${MAX_FETCH_BYTES / 1024 / 1024}MB).`;
    }

    // Stream body with size limit
    if (!res.body) {
      const raw = await res.text();
      const text = isHtml ? htmlToText(raw) : raw.trim();
      if (!text) return "Error: page returned empty content.";
      if (text.length > MAX_FETCH_CONTENT_CHARS) {
        return text.slice(0, MAX_FETCH_CONTENT_CHARS) + "\n\n[Content truncated]";
      }
      return text;
    }

    const decoder = new TextDecoder();
    const reader = res.body.getReader();
    let raw = "";
    let totalBytes = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_FETCH_BYTES) {
        reader.cancel();
        return "Error: page too large, download aborted.";
      }
      raw += decoder.decode(value, { stream: true });
    }

    const text = isHtml ? htmlToText(raw) : raw.trim();
    if (!text) return "Error: page returned empty content.";
    if (text.length > MAX_FETCH_CONTENT_CHARS) {
      return text.slice(0, MAX_FETCH_CONTENT_CHARS) + "\n\n[Content truncated]";
    }
    return text;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return "Error: request timed out.";
    }
    if (error instanceof TypeError && String(error).includes("redirect")) {
      return "Error: URL redirected, which is not followed for security reasons.";
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return `Error fetching URL: ${message}`;
  } finally {
    clearTimeout(timeout);
  }
}
