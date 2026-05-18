import type { SearchProvider } from "../providers/search-provider";
import type { SearchOptions, SearchResponse } from "../types/search";

const DEFAULT_SEARCH_CACHE_TTL_SECONDS = 15 * 60;

export class SearchService {
  constructor(
    private readonly searchProvider: SearchProvider,
    private readonly cache?: KVNamespace,
    private readonly cacheTtlSeconds = DEFAULT_SEARCH_CACHE_TTL_SECONDS
  ) {}

  async search(query: string, options: SearchOptions = {}): Promise<SearchResponse> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      return { query: normalizedQuery, results: [] };
    }

    const cacheKey = await createSearchCacheKey(normalizedQuery, options);
    const cached = await this.readCache(cacheKey);
    if (cached) {
      return {
        ...cached,
        cached: true
      };
    }

    const response = await this.searchProvider.search(normalizedQuery, options);
    await this.writeCache(cacheKey, response);
    return response;
  }

  private async readCache(cacheKey: string): Promise<SearchResponse | null> {
    if (!this.cache) return null;

    try {
      return await this.cache.get<SearchResponse>(cacheKey, "json");
    } catch (error) {
      console.warn("Search cache read failed", error);
      return null;
    }
  }

  private async writeCache(cacheKey: string, response: SearchResponse): Promise<void> {
    if (!this.cache || response.results.length === 0) return;

    try {
      await this.cache.put(cacheKey, JSON.stringify(response), {
        expirationTtl: this.cacheTtlSeconds
      });
    } catch (error) {
      console.warn("Search cache write failed", error);
    }
  }
}

async function createSearchCacheKey(query: string, options: SearchOptions): Promise<string> {
  const payload = JSON.stringify({
    q: query,
    num: options.num ?? null,
    kind: options.kind ?? "search",
    gl: options.gl ?? null,
    hl: options.hl ?? null,
    location: options.location ?? null
  });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
  const hash = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  return `search:${hash}`;
}
