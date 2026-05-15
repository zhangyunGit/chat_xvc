export type SearchResult = {
  title: string;
  link: string;
  snippet: string;
  date?: string;
  source?: string;
  position?: number;
};

export type SearchResponse = {
  query: string;
  results: SearchResult[];
};

