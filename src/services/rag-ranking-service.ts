import type { DocumentChunk } from "../types/domain";

export type RagRankCandidate = {
  chunk: DocumentChunk;
  vectorScore?: number;
  filename?: string;
};

export type RankedRagChunk = RagRankCandidate & {
  keywordScore: number;
  finalScore: number;
};

const stopwords = new Set([
  "什么",
  "怎么",
  "如何",
  "多少",
  "一下",
  "这个",
  "那个",
  "根据",
  "文档",
  "文件",
  "里面",
  "关于",
  "请问",
  "是不是",
  "是否"
]);

export class RagRankingService {
  rank(query: string, candidates: RagRankCandidate[]): RankedRagChunk[] {
    const deduped = dedupeCandidates(candidates);
    const terms = extractQueryTerms(query);

    const scored = deduped.map((candidate) => ({
      ...candidate,
      keywordScore: scoreCandidate(candidate, terms)
    }));

    const keywordMax = Math.max(...scored.map((candidate) => candidate.keywordScore), 1);
    const keywordWeight = hasExactSignals(query) ? 0.55 : query.trim().length < 12 ? 0.45 : 0.3;

    return scored
      .map((candidate) => {
        const normalizedKeyword = candidate.keywordScore / keywordMax;
        const normalizedVector = Math.max(0, Math.min(1, candidate.vectorScore ?? 0));

        return {
          ...candidate,
          finalScore: (1 - keywordWeight) * normalizedVector + keywordWeight * normalizedKeyword
        };
      })
      .sort((left, right) => right.finalScore - left.finalScore);
  }
}

export function extractQueryTerms(query: string): string[] {
  const normalized = query
    .toLowerCase()
    .replace(/[，。！？、,.!?;；:：()[\]{}"'“”‘’]/g, " ");

  const asciiTerms = normalized.match(/[a-z0-9_@./-]{2,}/g) ?? [];
  const chineseRuns = normalized.match(/[\u4e00-\u9fff]{2,}/g) ?? [];
  const chineseNgrams = chineseRuns.flatMap((run) => [...ngrams(run, 2), ...ngrams(run, 3)]);

  return unique([...asciiTerms, ...chineseRuns, ...chineseNgrams])
    .filter((term) => term.length >= 2 && !stopwords.has(term))
    .slice(0, 40);
}

function scoreCandidate(candidate: RagRankCandidate, terms: string[]): number {
  if (terms.length === 0) return 0;

  const content = candidate.chunk.content.toLowerCase();
  const sectionPath = candidate.chunk.sectionPath?.toLowerCase() ?? "";
  const filename = candidate.filename?.toLowerCase() ?? "";
  const totalCandidates = 1;
  let score = 0;

  for (const term of terms) {
    const contentCount = countOccurrences(content, term);
    const sectionCount = countOccurrences(sectionPath, term);
    const filenameCount = countOccurrences(filename, term);

    if (contentCount + sectionCount + filenameCount === 0) continue;

    const lengthWeight = term.length >= 4 ? 2.5 : 1;
    const idf = Math.log((1 + totalCandidates) / 1) + 1;

    score += Math.min(contentCount, 4) * lengthWeight * idf;
    score += Math.min(sectionCount, 2) * lengthWeight * idf * 3;
    score += Math.min(filenameCount, 2) * lengthWeight * idf * 2;
  }

  if (hasExactSignals(candidate.chunk.content)) {
    score += 1;
  }

  return score;
}

function dedupeCandidates(candidates: RagRankCandidate[]): RagRankCandidate[] {
  const byChunkId = new Map<string, RagRankCandidate>();

  for (const candidate of candidates) {
    const existing = byChunkId.get(candidate.chunk.id);
    if (!existing || (candidate.vectorScore ?? 0) > (existing.vectorScore ?? 0)) {
      byChunkId.set(candidate.chunk.id, candidate);
    }
  }

  return [...byChunkId.values()];
}

function countOccurrences(text: string, term: string): number {
  if (!text || !term) return 0;

  let count = 0;
  let index = text.indexOf(term);

  while (index !== -1) {
    count += 1;
    index = text.indexOf(term, index + term.length);
  }

  return count;
}

function ngrams(text: string, size: number): string[] {
  if (text.length < size) return [];

  const values: string[] = [];
  for (let index = 0; index <= text.length - size; index += 1) {
    values.push(text.slice(index, index + size));
  }

  return values;
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function hasExactSignals(text: string): boolean {
  return /[a-z0-9_@./-]{3,}|\d+\s?(mb|kb|gb|个|天|次|%)/i.test(text);
}
