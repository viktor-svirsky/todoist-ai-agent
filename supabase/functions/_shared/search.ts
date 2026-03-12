interface SearchResult {
  title: string;
  url: string;
  description: string;
}

const BRAVE_SEARCH_TIMEOUT_MS = 15_000;

export async function braveSearch(
  apiKey: string,
  query: string,
  count = 5
): Promise<SearchResult[]> {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(count));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BRAVE_SEARCH_TIMEOUT_MS);

  try {
    const res = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": apiKey,
      },
      signal: controller.signal,
    });

    if (!res.ok) throw new Error(`Brave search failed: ${res.status}`);

    const data = await res.json();
    return (data.web?.results || []).map((r: Record<string, string>) => ({
      title: r.title,
      url: r.url,
      description: r.description,
    }));
  } finally {
    clearTimeout(timeout);
  }
}
