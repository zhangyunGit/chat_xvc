import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const datasetPresets = {
  ecom: {
    name: "C-MTEB/EcomRetrieval",
    qrelsName: "C-MTEB/EcomRetrieval-qrels",
    config: "default",
    corpusSplit: "corpus",
    queriesSplit: "queries",
    qrelsSplit: "dev"
  }
};

const defaultOptions = {
  dataset: "ecom",
  queries: 50,
  candidates: 10000,
  topK: [1, 3, 5, 10],
  seed: 20260517,
  sampling: "targeted",
  hfApiBase: "https://datasets-server.huggingface.co",
  pageSize: 100,
  embedding: "auto",
  embeddingBatchSize: 64,
  embeddingModel: process.env.DEFAULT_EMBEDDING_MODEL || "@cf/baai/bge-m3",
  vectorDimensions: Number(process.env.VECTOR_DIMENSIONS || 1024),
  offlineSmoke: false
};

const options = parseArgs(process.argv.slice(2));

if (options.help) {
  printHelp();
  process.exit(0);
}

const tempDir = mkdtempSync(join(tmpdir(), "chat-xvc-eval-memory-retrieval-"));

try {
  const bundledMemoryServicePath = join(tempDir, "memory-service.mjs");
  execFileSync(
    "npx",
    [
      "esbuild",
      "src/services/memory-service.ts",
      "--bundle",
      "--format=esm",
      `--outfile=${bundledMemoryServicePath}`
    ],
    { stdio: "inherit" }
  );

  const { MemoryService } = await import(pathToFileURL(bundledMemoryServicePath).href);
  const sample = options.offlineSmoke
    ? createOfflineSmokeSample(options)
    : await loadHuggingFaceSample(options);
  const result = await evaluateSample({ options, MemoryService, sample });
  printResult(result);
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

function parseArgs(args) {
  const parsed = { ...defaultOptions };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const readValue = () => {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`Missing value for ${arg}`);
      }
      index += 1;
      return value;
    };

    if (arg === "--help" || arg === "-h") parsed.help = true;
    else if (arg === "--offline-smoke") parsed.offlineSmoke = true;
    else if (arg === "--dataset") parsed.dataset = readValue();
    else if (arg === "--queries") parsed.queries = Number(readValue());
    else if (arg === "--candidates") parsed.candidates = Number(readValue());
    else if (arg === "--seed") parsed.seed = Number(readValue());
    else if (arg === "--sampling") parsed.sampling = readValue();
    else if (arg === "--hf-api-base") parsed.hfApiBase = readValue();
    else if (arg === "--page-size") parsed.pageSize = Number(readValue());
    else if (arg === "--embedding") parsed.embedding = readValue();
    else if (arg === "--embedding-batch-size") parsed.embeddingBatchSize = Number(readValue());
    else if (arg === "--embedding-model") parsed.embeddingModel = readValue();
    else if (arg === "--vector-dimensions") parsed.vectorDimensions = Number(readValue());
    else if (arg === "--topK") {
      parsed.topK = readValue()
        .split(",")
        .map((item) => Number(item.trim()))
        .filter((item) => Number.isInteger(item) && item > 0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!datasetPresets[parsed.dataset]) {
    throw new Error(`Unsupported dataset "${parsed.dataset}". Supported: ${Object.keys(datasetPresets).join(", ")}`);
  }
  if (!Number.isInteger(parsed.queries) || parsed.queries <= 0) throw new Error("--queries must be a positive integer");
  if (!Number.isInteger(parsed.candidates) || parsed.candidates <= 0) {
    throw new Error("--candidates must be a positive integer");
  }
  if (!Array.isArray(parsed.topK) || parsed.topK.length === 0) throw new Error("--topK must contain integers");
  if (!Number.isInteger(parsed.vectorDimensions) || parsed.vectorDimensions <= 0) {
    throw new Error("--vector-dimensions must be a positive integer");
  }
  if (!["auto", "cloudflare", "hash"].includes(parsed.embedding)) {
    throw new Error("--embedding must be one of: auto, cloudflare, hash");
  }
  if (!["targeted", "prefix"].includes(parsed.sampling)) {
    throw new Error("--sampling must be one of: targeted, prefix");
  }

  parsed.topK = [...new Set(parsed.topK)].sort((a, b) => a - b);
  return parsed;
}

async function loadHuggingFaceSample(options) {
  const preset = datasetPresets[options.dataset];
  console.log(`Loading ${preset.name} from Hugging Face datasets-server...`);
  console.log(`Candidate corpus rows: ${options.candidates}; requested queries: ${options.queries}`);

  if (options.sampling === "targeted") {
    return loadTargetedHuggingFaceSample(options, preset);
  }

  let corpusRows;
  let queryRows;
  let qrelsRows;

  try {
    [corpusRows, queryRows, qrelsRows] = await Promise.all([
      fetchRows({
        dataset: preset.name,
        config: preset.config,
        split: preset.corpusSplit,
        limit: options.candidates,
        options
      }),
      fetchRows({
        dataset: preset.name,
        config: preset.config,
        split: preset.queriesSplit,
        limit: 1000,
        options
      }),
      fetchRows({
        dataset: preset.qrelsName,
        config: preset.config,
        split: preset.qrelsSplit,
        limit: 1000,
        options
      })
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`datasets-server failed, falling back to raw parquet files: ${message}`);
    [corpusRows, queryRows, qrelsRows] = await Promise.all([
      fetchParquetRows({
        dataset: preset.name,
        pathPrefix: "data/corpus",
        limit: options.candidates
      }),
      fetchParquetRows({
        dataset: preset.name,
        pathPrefix: "data/queries",
        limit: 1000
      }),
      fetchParquetRows({
        dataset: preset.qrelsName,
        pathPrefix: "data/dev",
        limit: 1000
      })
    ]);
  }

  const corpus = corpusRows.map(toCorpusDocument).filter((item) => item.id && item.text);
  const corpusIds = new Set(corpus.map((item) => item.id));
  const queryById = new Map(queryRows.map(toQuery).filter((item) => item.id && item.text).map((item) => [item.id, item]));
  const relevantByQueryId = new Map();

  for (const qrelRow of qrelsRows) {
    const qrel = toQrel(qrelRow);
    if (!qrel.queryId || !qrel.documentId || qrel.score <= 0) continue;
    if (!queryById.has(qrel.queryId) || !corpusIds.has(qrel.documentId)) continue;
    const docs = relevantByQueryId.get(qrel.queryId) ?? new Set();
    docs.add(qrel.documentId);
    relevantByQueryId.set(qrel.queryId, docs);
  }

  const eligibleQueries = [...relevantByQueryId.keys()]
    .map((id) => queryById.get(id))
    .filter(Boolean);
  const selectedQueries = shuffleDeterministic(eligibleQueries, options.seed).slice(0, options.queries);

  if (selectedQueries.length === 0) {
    throw new Error(
      `No qrels matched the first ${options.candidates} candidate documents. Increase --candidates.`
    );
  }

  if (selectedQueries.length < options.queries) {
    console.warn(
      `Only ${selectedQueries.length} eligible queries matched the candidate pool; requested ${options.queries}.`
    );
  }

  return {
    dataset: preset.name,
    corpus,
    queries: selectedQueries,
    relevantByQueryId,
    notes: [
      `HF rows API sample: first ${corpus.length} corpus rows`,
      `eligible queries with positive qrels inside candidate pool: ${eligibleQueries.length}`
    ]
  };
}

async function loadTargetedHuggingFaceSample(options, preset) {
  console.log("Sampling mode: targeted qrels positives + random negatives");

  let corpusRows;
  let queryRows;
  let qrelsRows;

  try {
    [corpusRows, queryRows, qrelsRows] = await Promise.all([
      fetchRows({
        dataset: preset.name,
        config: preset.config,
        split: preset.corpusSplit,
        limit: 200000,
        options
      }),
      fetchRows({
        dataset: preset.name,
        config: preset.config,
        split: preset.queriesSplit,
        limit: 10000,
        options
      }),
      fetchRows({
        dataset: preset.qrelsName,
        config: preset.config,
        split: preset.qrelsSplit,
        limit: 10000,
        options
      })
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`datasets-server failed, falling back to raw parquet files: ${message}`);
    [corpusRows, queryRows, qrelsRows] = await Promise.all([
      fetchParquetRows({
        dataset: preset.name,
        pathPrefix: "data/corpus",
        limit: 200000
      }),
      fetchParquetRows({
        dataset: preset.name,
        pathPrefix: "data/queries",
        limit: 10000
      }),
      fetchParquetRows({
        dataset: preset.qrelsName,
        pathPrefix: "data/dev",
        limit: 10000
      })
    ]);
  }

  const allCorpus = corpusRows.map(toCorpusDocument).filter((item) => item.id && item.text);
  const corpusById = new Map(allCorpus.map((item) => [item.id, item]));
  const queryById = new Map(queryRows.map(toQuery).filter((item) => item.id && item.text).map((item) => [item.id, item]));
  const relevantByQueryId = new Map();

  for (const qrelRow of qrelsRows) {
    const qrel = toQrel(qrelRow);
    if (!qrel.queryId || !qrel.documentId || qrel.score <= 0) continue;
    if (!queryById.has(qrel.queryId) || !corpusById.has(qrel.documentId)) continue;
    const docs = relevantByQueryId.get(qrel.queryId) ?? new Set();
    docs.add(qrel.documentId);
    relevantByQueryId.set(qrel.queryId, docs);
  }

  const eligibleQueries = [...relevantByQueryId.keys()]
    .map((id) => queryById.get(id))
    .filter(Boolean);
  const selectedQueries = shuffleDeterministic(eligibleQueries, options.seed).slice(0, options.queries);

  if (selectedQueries.length === 0) {
    throw new Error("No eligible qrels found in the dataset.");
  }
  if (selectedQueries.length < options.queries) {
    console.warn(`Only ${selectedQueries.length} eligible queries available; requested ${options.queries}.`);
  }

  const positiveDocIds = new Set(
    selectedQueries.flatMap((query) => [...(relevantByQueryId.get(query.id) ?? [])])
  );
  const positiveDocs = [...positiveDocIds].map((id) => corpusById.get(id)).filter(Boolean);
  const negativeCount = Math.max(0, options.candidates - positiveDocs.length);
  const negativeDocs = shuffleDeterministic(
    allCorpus.filter((doc) => !positiveDocIds.has(doc.id)),
    options.seed + 17
  ).slice(0, negativeCount);
  const sampledCorpus = shuffleDeterministic([...positiveDocs, ...negativeDocs], options.seed + 31);

  return {
    dataset: preset.name,
    corpus: sampledCorpus,
    queries: selectedQueries,
    relevantByQueryId,
    notes: [
      `targeted qrels sample: ${selectedQueries.length} queries`,
      `positive documents included: ${positiveDocs.length}`,
      `random negative documents included: ${negativeDocs.length}`,
      `full corpus rows loaded locally: ${allCorpus.length}`
    ]
  };
}

async function fetchRows({ dataset, config, split, limit, options }) {
  const rows = [];
  const pageSize = Math.max(1, Math.min(options.pageSize, 100));

  for (let offset = 0; offset < limit; offset += pageSize) {
    const length = Math.min(pageSize, limit - offset);
    const url = new URL("/rows", options.hfApiBase);
    url.searchParams.set("dataset", dataset);
    url.searchParams.set("config", config);
    url.searchParams.set("split", split);
    url.searchParams.set("offset", String(offset));
    url.searchParams.set("length", String(length));

    let response;
    try {
      response = await fetch(url);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to reach Hugging Face datasets-server for ${dataset}/${split} at offset ${offset}: ${message}. ` +
          "Check network/proxy access or pass --hf-api-base."
      );
    }
    if (!response.ok) {
      throw new Error(`Failed to fetch ${dataset}/${split} rows at offset ${offset}: ${response.status}`);
    }

    const payload = await response.json();
    const pageRows = Array.isArray(payload.rows) ? payload.rows : [];
    if (pageRows.length === 0) break;
    rows.push(...pageRows.map((item) => item.row));
    if (pageRows.length < length) break;
  }

  return rows;
}

async function fetchParquetRows({ dataset, pathPrefix, limit }) {
  const filesUrl = `https://huggingface.co/api/datasets/${dataset}/tree/main/data`;
  const files = JSON.parse(
    execFileSync("curl", ["-L", "-s", filesUrl], {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024
    })
  );
  const file = files.find((item) => item.type === "file" && item.path.startsWith(pathPrefix) && item.path.endsWith(".parquet"));
  if (!file) {
    throw new Error(`No parquet file found for ${dataset} with prefix ${pathPrefix}`);
  }

  const parquetUrl = `https://huggingface.co/datasets/${dataset}/resolve/main/${file.path}`;
  const parquetPath = join(tempDir, `${dataset.replaceAll("/", "__")}__${file.path.replaceAll("/", "__")}`);
  execFileSync("curl", ["-L", "-s", "-o", parquetPath, parquetUrl], {
    stdio: "pipe",
    maxBuffer: 16 * 1024 * 1024
  });
  const outputPath = `${parquetPath}.json`;
  const python = [
    "import json, sys",
    "import pyarrow.parquet as pq",
    "path, out, limit = sys.argv[1], sys.argv[2], int(sys.argv[3])",
    "table = pq.read_table(path)",
    "rows = table.slice(0, limit).to_pylist()",
    "with open(out, 'w', encoding='utf-8') as f:",
    "    json.dump(rows, f, ensure_ascii=False)"
  ].join("\n");

  execFileSync("python3", ["-c", python, parquetPath, outputPath, String(limit)], {
    stdio: "pipe",
    maxBuffer: 256 * 1024 * 1024
  });

  return JSON.parse(readFileSync(outputPath, "utf8"));
}

function toCorpusDocument(row) {
  const id = String(row._id ?? row.id ?? row.pid ?? "").trim();
  const title = String(row.title ?? "").trim();
  const text = stripHtml(String(row.text ?? row.content ?? "").trim());
  return {
    id,
    text: [title, text].filter(Boolean).join("\n")
  };
}

function toQuery(row) {
  return {
    id: String(row._id ?? row.id ?? row.qid ?? row["query-id"] ?? "").trim(),
    text: stripHtml(String(row.text ?? row.query ?? "").trim())
  };
}

function toQrel(row) {
  return {
    queryId: String(row.qid ?? row.query_id ?? row["query-id"] ?? "").trim(),
    documentId: String(row.pid ?? row.corpus_id ?? row.docid ?? row["corpus-id"] ?? "").trim(),
    score: Number(row.score ?? row.relevance ?? 0)
  };
}

function createOfflineSmokeSample(options) {
  const corpus = [
    { id: "doc_1", text: "我喜欢回答先给结论，然后给必要步骤。" },
    { id: "doc_2", text: "用户正在开发 Cloudflare Workers 智能助手。" },
    { id: "doc_3", text: "文件上传后需要解析、切片、生成向量并写入检索库。" },
    { id: "doc_4", text: "深度研究需要先拆解计划，再进行多轮搜索和综合报告。" },
    { id: "doc_5", text: "任务删除和修改要支持第几个、这个、它等指代。" }
  ];
  const queries = [
    { id: "q_1", text: "我的回答偏好是什么" },
    { id: "q_2", text: "文件处理流程是什么" },
    { id: "q_3", text: "深度研究怎么做" },
    { id: "q_4", text: "任务管理要解决什么指代问题" }
  ].slice(0, options.queries);
  const relevantByQueryId = new Map([
    ["q_1", new Set(["doc_1"])],
    ["q_2", new Set(["doc_3"])],
    ["q_3", new Set(["doc_4"])],
    ["q_4", new Set(["doc_5"])]
  ]);

  return {
    dataset: "offline-smoke",
    corpus,
    queries,
    relevantByQueryId,
    notes: ["Built-in smoke sample; use without network to verify the evaluation pipeline."]
  };
}

async function evaluateSample({ options, MemoryService, sample }) {
  const embeddingRunner = createEmbeddingRunner(options);
  const memories = [];
  const vectors = [];
  const docIdByMemoryId = new Map();
  const userId = `eval_memory_${options.dataset}_${options.seed}`;
  const maxK = Math.max(...options.topK);

  const env = {
    DB: createMemoryDb(memories),
    VECTORIZE: createInMemoryVectorIndex(vectors),
    AI: {
      async run(model, input) {
        return { data: await embeddingRunner.embed(input.text, model) };
      }
    },
    DEFAULT_EMBEDDING_MODEL: options.embeddingModel,
    VECTOR_DIMENSIONS: String(options.vectorDimensions)
  };

  console.log(`Embedding provider: ${embeddingRunner.name}`);
  console.log(`Indexing ${sample.corpus.length} candidate memories...`);

  for (let offset = 0; offset < sample.corpus.length; offset += options.embeddingBatchSize) {
    const batch = sample.corpus.slice(offset, offset + options.embeddingBatchSize);
    const embeddings = await embeddingRunner.embed(batch.map((item) => item.text), options.embeddingModel);

    for (let index = 0; index < batch.length; index += 1) {
      const doc = batch[index];
      const memoryId = `eval:${doc.id}`;
      const vectorId = `memory:${memoryId}`;
      const timestamp = "2026-05-17T00:00:00Z";

      memories.push({
        id: memoryId,
        user_id: userId,
        content: doc.text,
        kind: "other",
        vector_id: vectorId,
        source_message_id: null,
        confidence: 1,
        status: "active",
        embedding_model: options.embeddingModel,
        created_at: timestamp,
        updated_at: timestamp
      });
      vectors.push({
        id: vectorId,
        values: embeddings[index],
        metadata: {
          type: "memory",
          userId,
          memoryId,
          status: "active",
          documentId: doc.id
        }
      });
      docIdByMemoryId.set(memoryId, doc.id);
    }
  }

  const service = new MemoryService(env);
  const rows = [];
  const totals = {
    queries: 0,
    mrr: 0,
    ndcg: 0,
    precisionAt: Object.fromEntries(options.topK.map((k) => [k, 0])),
    recallAt: Object.fromEntries(options.topK.map((k) => [k, 0])),
    hitAt: Object.fromEntries(options.topK.map((k) => [k, 0]))
  };

  console.log(`Evaluating ${sample.queries.length} queries...`);
  for (const query of sample.queries) {
    const relevant = sample.relevantByQueryId.get(query.id) ?? new Set();
    if (relevant.size === 0) continue;

    const recalled = await service.recall({ userId, query: query.text, topK: maxK, types: ["memory"] });
    const retrievedDocIds = recalled.map((memory) => docIdByMemoryId.get(memory.id)).filter(Boolean);
    const metrics = scoreRanking(retrievedDocIds, relevant, options.topK);

    totals.queries += 1;
    totals.mrr += metrics.mrr;
    totals.ndcg += metrics.ndcg;
    for (const k of options.topK) {
      totals.precisionAt[k] += metrics.precisionAt[k];
      totals.recallAt[k] += metrics.recallAt[k];
      totals.hitAt[k] += metrics.hitAt[k];
    }

    rows.push({
      queryId: query.id,
      query: query.text,
      relevant: [...relevant],
      retrieved: retrievedDocIds,
      firstRelevantRank: metrics.firstRelevantRank
    });
  }

  if (totals.queries === 0) {
    throw new Error("No evaluable queries. Increase --candidates or choose another dataset.");
  }

  return {
    dataset: sample.dataset,
    options,
    embeddingProvider: embeddingRunner.name,
    corpusSize: sample.corpus.length,
    querySize: totals.queries,
    notes: sample.notes,
    metrics: {
      mrrAtMaxK: totals.mrr / totals.queries,
      ndcgAtMaxK: totals.ndcg / totals.queries,
      precisionAt: averageByQuery(totals.precisionAt, totals.queries),
      recallAt: averageByQuery(totals.recallAt, totals.queries),
      hitAt: averageByQuery(totals.hitAt, totals.queries)
    },
    examples: rows.slice(0, 5)
  };
}

function createMemoryDb(memories) {
  return {
    prepare(sql) {
      return {
        values: [],
        bind(...values) {
          this.values = values;
          return this;
        },
        async run() {
          throw new Error(`Unexpected write SQL during eval: ${sql}`);
        },
        async first() {
          if (sql === "SELECT * FROM memories WHERE user_id = ? AND id = ?") {
            const [userId, id] = this.values;
            return memories.find((memory) => memory.user_id === userId && memory.id === id) ?? null;
          }
          throw new Error(`Unexpected first SQL during eval: ${sql}`);
        },
        async all() {
          if (sql.includes("status = 'active'") && sql.includes("vector_id IN")) {
            const [userId, ...vectorIds] = this.values;
            return {
              results: memories.filter((memory) =>
                memory.user_id === userId &&
                memory.status === "active" &&
                vectorIds.includes(memory.vector_id)
              )
            };
          }

          if (sql.includes("status = 'active'")) {
            const [userId, limit] = this.values;
            return {
              results: memories
                .filter((memory) => memory.user_id === userId && memory.status === "active")
                .slice(0, limit)
            };
          }

          throw new Error(`Unexpected all SQL during eval: ${sql}`);
        }
      };
    }
  };
}

function createInMemoryVectorIndex(vectors) {
  return {
    async upsert(newVectors) {
      vectors.push(...newVectors);
    },
    async deleteByIds(ids) {
      const idSet = new Set(ids);
      for (let index = vectors.length - 1; index >= 0; index -= 1) {
        if (idSet.has(vectors[index].id)) vectors.splice(index, 1);
      }
    },
    async query(values, queryOptions) {
      const filter = queryOptions?.filter ?? {};
      const topK = queryOptions?.topK ?? 10;
      const matches = vectors
        .filter((vector) => metadataMatches(vector.metadata, filter))
        .map((vector) => ({
          id: vector.id,
          score: cosineSimilarity(values, vector.values),
          metadata: vector.metadata
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);
      return { matches };
    }
  };
}

function metadataMatches(metadata, filter) {
  return Object.entries(filter).every(([key, value]) => metadata?.[key] === value);
}

function createEmbeddingRunner(options) {
  const cloudflareAccountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? readCloudflareAccountIdFromConfig();
  const shouldUseCloudflare =
    options.embedding === "cloudflare" ||
    (options.embedding === "auto" && process.env.CLOUDFLARE_API_TOKEN && cloudflareAccountId);

  if (shouldUseCloudflare) {
    if (!process.env.CLOUDFLARE_API_TOKEN || !cloudflareAccountId) {
      throw new Error("Cloudflare embedding requires CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID");
    }
    return {
      name: `cloudflare-workers-ai:${options.embeddingModel}`,
      async embed(texts, model) {
        const response = await fetch(
          `https://api.cloudflare.com/client/v4/accounts/${cloudflareAccountId}/ai/run/${model}`,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
              "content-type": "application/json"
            },
            body: JSON.stringify({ text: texts })
          }
        );

        if (!response.ok) {
          throw new Error(`Cloudflare Workers AI embedding failed: ${response.status} ${await response.text()}`);
        }

        const payload = await response.json();
        const data = payload?.result?.data ?? payload?.data;
        if (!Array.isArray(data)) {
          throw new Error("Cloudflare Workers AI embedding response did not include result.data");
        }
        return data;
      }
    };
  }

  if (options.embedding === "auto") {
    console.warn(
      "CLOUDFLARE_API_TOKEN/CLOUDFLARE_ACCOUNT_ID not found; using deterministic hash embeddings. " +
        "Use --embedding cloudflare for meaningful model-quality numbers."
    );
  }

  return {
    name: `hash-baseline:${options.vectorDimensions}d`,
    async embed(texts) {
      return texts.map((text) => hashEmbedding(text, options.vectorDimensions));
    }
  };
}

function readCloudflareAccountIdFromConfig() {
  try {
    const config = JSON.parse(readFileSync("config.json", "utf8"));
    return config?.cloudflare?.account_id ?? config?.cloudflare?.accountId ?? config?.CLOUDFLARE_ACCOUNT_ID ?? null;
  } catch {
    return null;
  }
}

function hashEmbedding(text, dimensions) {
  const values = new Array(dimensions).fill(0);
  const normalized = stripHtml(text).toLowerCase().replace(/\s+/g, " ").trim();
  const tokens = normalized.match(/[\p{Script=Han}]|[a-z0-9]+/gu) ?? [];
  const features = [];

  for (const token of tokens) features.push(token);
  for (let index = 0; index < tokens.length - 1; index += 1) features.push(tokens[index] + tokens[index + 1]);

  for (const feature of features) {
    const hash = fnv1a(feature);
    const bucket = hash % dimensions;
    values[bucket] += hash % 2 === 0 ? 1 : -1;
  }

  const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0)) || 1;
  return values.map((value) => value / norm);
}

function fnv1a(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function cosineSimilarity(left, right) {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  const length = Math.min(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }

  return dot / ((Math.sqrt(leftNorm) || 1) * (Math.sqrt(rightNorm) || 1));
}

function scoreRanking(retrievedDocIds, relevant, topKValues) {
  const precisionAt = {};
  const recallAt = {};
  const hitAt = {};
  const firstRelevantIndex = retrievedDocIds.findIndex((docId) => relevant.has(docId));
  const firstRelevantRank = firstRelevantIndex >= 0 ? firstRelevantIndex + 1 : null;
  const maxK = Math.max(...topKValues);
  const mrr = firstRelevantRank && firstRelevantRank <= maxK ? 1 / firstRelevantRank : 0;
  const dcg = retrievedDocIds.slice(0, maxK).reduce((sum, docId, index) => {
    return sum + (relevant.has(docId) ? 1 / Math.log2(index + 2) : 0);
  }, 0);
  const idealRelevantCount = Math.min(relevant.size, maxK);
  let idcg = 0;
  for (let index = 0; index < idealRelevantCount; index += 1) {
    idcg += 1 / Math.log2(index + 2);
  }

  for (const k of topKValues) {
    const top = retrievedDocIds.slice(0, k);
    const hits = top.filter((docId) => relevant.has(docId)).length;
    precisionAt[k] = hits / k;
    recallAt[k] = hits / relevant.size;
    hitAt[k] = hits > 0 ? 1 : 0;
  }

  return {
    precisionAt,
    recallAt,
    hitAt,
    mrr,
    ndcg: idcg > 0 ? dcg / idcg : 0,
    firstRelevantRank
  };
}

function averageByQuery(valuesByK, queryCount) {
  return Object.fromEntries(
    Object.entries(valuesByK).map(([k, value]) => [k, value / queryCount])
  );
}

function shuffleDeterministic(items, seed) {
  const result = [...items];
  let state = seed >>> 0;
  for (let index = result.length - 1; index > 0; index -= 1) {
    state = Math.imul(1664525, state) + 1013904223;
    const swapIndex = (state >>> 0) % (index + 1);
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function stripHtml(value) {
  return value
    .replace(/<br\s*\/?>/giu, "\n")
    .replace(/<[^>]+>/gu, " ")
    .replace(/&nbsp;/gu, " ")
    .replace(/&amp;/gu, "&")
    .replace(/\s+/gu, " ")
    .trim();
}

function formatNumber(value) {
  return value.toFixed(4);
}

function printResult(result) {
  console.log("");
  console.log("Memory Retrieval Evaluation");
  console.log("===========================");
  console.log(`Dataset: ${result.dataset}`);
  console.log(`Embedding: ${result.embeddingProvider}`);
  console.log(`Candidates: ${result.corpusSize}`);
  console.log(`Evaluated queries: ${result.querySize}`);
  for (const note of result.notes) console.log(`Note: ${note}`);

  console.log("");
  console.log("Metrics");
  console.log("-------");
  console.log(`MRR@${Math.max(...result.options.topK)}: ${formatNumber(result.metrics.mrrAtMaxK)}`);
  console.log(`nDCG@${Math.max(...result.options.topK)}: ${formatNumber(result.metrics.ndcgAtMaxK)}`);
  for (const k of result.options.topK) {
    console.log(
      [
        `K=${k}`,
        `Hit@${k}=${formatNumber(result.metrics.hitAt[k])}`,
        `Recall@${k}=${formatNumber(result.metrics.recallAt[k])}`,
        `Precision@${k}=${formatNumber(result.metrics.precisionAt[k])}`
      ].join("  ")
    );
  }

  console.log("");
  console.log("Examples");
  console.log("--------");
  for (const example of result.examples) {
    console.log(
      `${example.queryId}: firstRelevantRank=${example.firstRelevantRank ?? "miss"} ` +
        `relevant=${example.relevant.join(",")} retrieved=${example.retrieved.slice(0, 5).join(",")}`
    );
    console.log(`  ${example.query}`);
  }
}

function printHelp() {
  console.log(`Usage:
  node scripts/eval-memory-retrieval.mjs [options]

Options:
  --dataset ecom              Dataset preset. Default: ecom
  --queries 50                Number of eligible queries to evaluate
  --candidates 10000          Number of corpus rows to index as candidate memories
  --topK 1,3,5,10             K values for Hit/Recall/Precision
  --seed 20260517             Deterministic query sampling seed
  --sampling targeted         targeted | prefix
  --embedding auto            auto | cloudflare | hash
  --embedding-model MODEL     Default: DEFAULT_EMBEDDING_MODEL or @cf/baai/bge-m3
  --vector-dimensions 1024    Expected embedding dimensions
  --offline-smoke             Use built-in tiny sample without network
  --help                      Show this help

Cloudflare embedding mode:
  CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... \\
    node scripts/eval-memory-retrieval.mjs --embedding cloudflare

Notes:
  The ecom preset uses C-MTEB/EcomRetrieval plus EcomRetrieval-qrels from Hugging Face.
  targeted sampling includes qrels-positive documents for selected queries plus random negatives.
  Reported metrics are for the sampled candidate pool, not the official full-corpus C-MTEB score.
`);
}
