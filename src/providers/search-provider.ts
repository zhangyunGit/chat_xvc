import type { SearchOptions, SearchResponse } from "../types/search";

export interface SearchProvider {
  search(query: string, options?: SearchOptions): Promise<SearchResponse>;
}
