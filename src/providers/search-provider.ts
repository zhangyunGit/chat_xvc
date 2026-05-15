import type { SearchResponse } from "../types/search";

export interface SearchProvider {
  search(query: string): Promise<SearchResponse>;
}

