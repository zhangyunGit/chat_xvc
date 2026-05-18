export type SearchResult = {
  title: string;
  link: string;
  snippet: string;
  date?: string;
  source?: string;
  position?: number;
  kind?: "organic" | "news";
};

export type SearchResponse = {
  query: string;
  results: SearchResult[];
  cached?: boolean;
};

export type SearchOptions = {
  num?: number;
  kind?: "search" | "news";
  gl?: string;
  hl?: string;
  location?: string;
};
