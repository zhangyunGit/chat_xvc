import { SerperProvider } from "../providers/serper-provider";
import { SearchService } from "../services/search-service";
import type { SearchOptions, SearchResponse } from "../types/search";

export class SearchTools {
  private readonly searchService: SearchService;

  constructor(env: Env) {
    this.searchService = new SearchService(new SerperProvider(env.SERPER_API_KEY), env.CACHE);
  }

  async webSearch(query: string, options?: SearchOptions): Promise<SearchResponse> {
    return this.searchService.search(query, options);
  }
}
