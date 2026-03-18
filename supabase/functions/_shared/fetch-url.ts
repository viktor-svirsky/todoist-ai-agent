import { isPrivateHostname } from "./validation.ts";
import {
  FETCH_URL_TIMEOUT_MS,
  MAX_FETCH_BYTES,
  MAX_FETCH_CONTENT_CHARS,
} from "./constants.ts";

/** Tags whose content should be completely suppressed. */
const SUPPRESSED_TAGS = new Set([
  "script", "style", "noscript", "nav", "header", "footer",
]);

/** Block-level tags that produce a newline when closed. */
const BLOCK_TAGS = new Set([
  "p", "div", "h1", "h2", "h3", "h4", "h5", "h6",
  "li", "tr", "blockquote", "section", "article", "br",
]);

/** Decode HTML entities to plain characters. */
function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCharCode(Number(dec)))
    .replace(/&amp;/g, "&");
}

/**
 * Strip HTML to plain text for AI consumption.
 * Uses a character-level parser instead of regex tag matching
 * to avoid incomplete sanitization edge cases.
 */
export function htmlToText(html: string): string {
  let result = "";
  let i = 0;
  const len = html.length;

  // Stack of suppressed tags (supports nesting)
  let suppressDepth = 0;
  const suppressStack: string[] = [];

  while (i < len) {
    // Detect tag opening
    if (html[i] === "<") {
      // Collect the full tag content between < and >
      const closeIdx = html.indexOf(">", i);
      if (closeIdx === -1) {
        // Malformed: no closing >, skip the rest
        break;
      }
      const tagContent = html.substring(i + 1, closeIdx);
      i = closeIdx + 1;

      // Parse tag name (first token, ignoring attributes)
      const trimmed = tagContent.trimStart();
      const isClosing = trimmed.startsWith("/");
      const nameStart = isClosing ? 1 : 0;
      let nameEnd = nameStart;
      while (nameEnd < trimmed.length && !/[\s/>]/.test(trimmed[nameEnd])) {
        nameEnd++;
      }
      const tagName = trimmed.substring(nameStart, nameEnd).toLowerCase();

      if (isClosing) {
        // Closing tag
        if (SUPPRESSED_TAGS.has(tagName) && suppressDepth > 0) {
          const last = suppressStack[suppressStack.length - 1];
          if (last === tagName) {
            suppressStack.pop();
            suppressDepth--;
          }
        }
        if (suppressDepth === 0 && BLOCK_TAGS.has(tagName)) {
          result += "\n";
        }
      } else {
        // Opening or self-closing tag
        if (SUPPRESSED_TAGS.has(tagName)) {
          suppressStack.push(tagName);
          suppressDepth++;
        }
        // <br> / <br/> → newline
        if (tagName === "br" && suppressDepth === 0) {
          result += "\n";
        }
      }
      continue;
    }

    // Text content — only emit if not inside a suppressed block
    if (suppressDepth === 0) {
      result += html[i];
    }
    i++;
  }

  // Decode entities on the extracted text (no tags remain)
  let text = decodeEntities(result);

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

    // Fallback for responses with no readable stream
    if (!res.body) {
      const raw = await res.text();
      if (new TextEncoder().encode(raw).byteLength > MAX_FETCH_BYTES) {
        return "Error: page too large, download aborted.";
      }
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
        await reader.cancel();
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
