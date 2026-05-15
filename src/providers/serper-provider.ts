import type { SearchProvider } from "./search-provider";
import type { SearchResponse, SearchResult } from "../types/search";

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

  async search(query: string): Promise<SearchResponse> {
    if (!this.apiKey) {
      throw new Error("SERPER_API_KEY is not configured");
    }

    const response = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-API-KEY": this.apiKey
      },
      body: JSON.stringify({
        q: query,
        num: 8
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

  return [...organic, ...news]
    .map((item, index) => normalizeResult(item as SerperOrganicResult, index + 1))
    .filter((result): result is SearchResult => Boolean(result));
}

function normalizeResult(item: SerperOrganicResult, fallbackPosition: number): SearchResult | null {
  if (typeof item.title !== "string" || typeof item.link !== "string") {
    return null;
  }

  return {
    title: item.title,
    link: item.link,
    snippet: typeof item.snippet === "string" ? item.snippet : "",
    date: typeof item.date === "string" ? item.date : undefined,
    source: typeof item.source === "string" ? item.source : undefined,
    position: typeof item.position === "number" ? item.position : fallbackPosition
  };
}

