import type { SearchProvider } from "./search-provider";
import type { SearchOptions, SearchResponse, SearchResult } from "../types/search";

type SerperOrganicResult = {
  title?: unknown;
  link?: unknown;
  snippet?: unknown;
  date?: unknown;
  source?: unknown;
  position?: unknown;
};

type SerperResponse = {
  organic?: unknown;
  news?: unknown;
};

export class SerperProvider implements SearchProvider {
  constructor(private readonly apiKey: string | undefined) {}

  async search(query: string, options: SearchOptions = {}): Promise<SearchResponse> {
    if (!this.apiKey) {
      throw new Error("SERPER_API_KEY is not configured");
    }

    const endpoint = options.kind === "news" ? "news" : "search";
    const response = await fetch(`https://google.serper.dev/${endpoint}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-API-KEY": this.apiKey
      },
      body: JSON.stringify({
        q: query,
        num: clampResultCount(options.num),
        ...(options.gl ? { gl: options.gl } : {}),
        ...(options.hl ? { hl: options.hl } : {}),
        ...(options.location ? { location: options.location } : {})
      })
    });

    if (!response.ok) {
      throw new Error(`Serper search failed with ${response.status}`);
    }

    const data = (await response.json()) as SerperResponse;

    return {
      query,
      results: normalizeResults(data)
    };
  }
}

function normalizeResults(data: SerperResponse): SearchResult[] {
  const organic = Array.isArray(data.organic) ? data.organic : [];
  const news = Array.isArray(data.news) ? data.news : [];

  return [
    ...organic.map((item) => ({ item, kind: "organic" as const })),
    ...news.map((item) => ({ item, kind: "news" as const }))
  ]
    .map(({ item, kind }, index) => normalizeResult(item as SerperOrganicResult, index + 1, kind))
    .filter((result): result is SearchResult => Boolean(result));
}

function normalizeResult(
  item: SerperOrganicResult,
  fallbackPosition: number,
  kind: SearchResult["kind"]
): SearchResult | null {
  if (typeof item.title !== "string" || typeof item.link !== "string") {
    return null;
  }

  return {
    title: item.title,
    link: item.link,
    snippet: typeof item.snippet === "string" ? item.snippet : "",
    date: typeof item.date === "string" ? item.date : undefined,
    source: typeof item.source === "string" ? item.source : undefined,
    position: typeof item.position === "number" ? item.position : fallbackPosition,
    kind
  };
}

function clampResultCount(value: number | undefined): number {
  if (!Number.isFinite(value)) return 8;
  return Math.max(1, Math.min(Math.floor(value as number), 20));
}
