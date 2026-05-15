import type { SearchProvider } from "../providers/search-provider";
import type { SearchResponse } from "../types/search";

export class SearchService {
  constructor(private readonly searchProvider: SearchProvider) {}

  async search(query: string): Promise<SearchResponse> {
    return this.searchProvider.search(query);
  }
}

