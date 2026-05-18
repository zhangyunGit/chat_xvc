export type UpsertDocumentVectorInput = {
  id: string;
  values: number[];
  metadata: Record<string, string | number | boolean | string[]>;
};

export type VectorSearchMatch = {
  id: string;
  score: number;
  metadata?: Record<string, VectorizeVectorMetadata>;
};

export class VectorRepository {
  constructor(private readonly index: VectorizeIndex) {}

  async upsert(vectors: UpsertDocumentVectorInput[]): Promise<void> {
    if (vectors.length === 0) return;

    await this.index.upsert(
      vectors.map((vector) => ({
        id: vector.id,
        values: vector.values,
        metadata: vector.metadata
      }))
    );
  }

  async deleteByIds(vectorIds: string[]): Promise<void> {
    if (vectorIds.length === 0) return;

    await this.index.deleteByIds(vectorIds);
  }

  async query(input: {
    values: number[];
    userId: string;
    topK: number;
    filter?: Record<string, string | number | boolean | string[]>;
  }): Promise<VectorSearchMatch[]> {
    const matches = await this.index.query(input.values, {
      topK: input.topK,
      returnMetadata: "all",
      filter: {
        userId: input.userId,
        ...(input.filter ?? {})
      }
    });

    return matches.matches.map((match) => ({
      id: match.id,
      score: match.score,
      metadata: match.metadata
    }));
  }
}
