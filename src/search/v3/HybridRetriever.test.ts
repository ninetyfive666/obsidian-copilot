import { Document } from "@langchain/core/documents";
import { App, TFile } from "obsidian";
import { getSharedChunkManager } from "./chunks";
import type { DocumentRetriever } from "@/search/RetrieverFactory";
import { LocalEmbeddingClient } from "@/search/embeddings/LocalEmbeddingClient";
import { LocalEmbeddingIndex } from "@/search/embeddings/LocalEmbeddingIndex";
import { HybridRetriever } from "./HybridRetriever";

jest.mock("./chunks", () => ({
  getSharedChunkManager: jest.fn(),
}));

const TFileConstructor = TFile as unknown as new (path: string) => TFile;

function lexicalDoc(chunkId: string, path: string, content: string): Document {
  return new Document({
    pageContent: content,
    metadata: {
      path,
      chunkId,
      title: path,
      score: 0.5,
      engine: "chunk-v3",
      includeInContext: true,
      isChunk: true,
    },
  });
}

function makeTFile(path: string): TFile {
  const file = new TFileConstructor(path);
  (file as unknown as { stat: { mtime: number; ctime: number } }).stat = {
    mtime: 1000,
    ctime: 900,
  };
  return file;
}

function makeApp(paths: string[]): App {
  return {
    vault: {
      getAbstractFileByPath: (path: string) => (paths.includes(path) ? makeTFile(path) : null),
      cachedRead: async () => "note body",
    },
    metadataCache: {
      getFileCache: () => ({ tags: [] }),
    },
  } as unknown as App;
}

describe("HybridRetriever", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("merges lexical and semantic results, deduplicating shared chunks", async () => {
    const lexical: Document[] = [
      lexicalDoc("a.md#0", "a.md", "lexical a"),
      lexicalDoc("b.md#0", "b.md", "lexical b"),
    ];
    const lexicalRetriever = {
      getRelevantDocuments: jest.fn(async () => lexical),
    } as unknown as DocumentRetriever;

    const app = makeApp(["a.md", "b.md", "c.md"]);
    const index = {
      waitForReady: jest.fn(async () => true),
      search: jest.fn(() => [
        { chunkId: "a.md#0", notePath: "a.md", score: 0.9 },
        { chunkId: "c.md#0", notePath: "c.md", score: 0.8 },
      ]),
    } as unknown as LocalEmbeddingIndex;
    const client = {
      embedQuery: jest.fn(async () => new Float32Array([1, 0])),
    } as unknown as LocalEmbeddingClient;
    jest.mocked(getSharedChunkManager).mockReturnValue({
      getChunkText: jest.fn(async (id: string) => `text of ${id}`),
    } as never);

    const retriever = new HybridRetriever(lexicalRetriever, index, client, app, 5);
    const results = await retriever.getRelevantDocuments("query");

    const engines = results.map((doc) => String(doc.metadata.chunkId));
    expect(engines).toEqual(["a.md#0", "b.md#0", "c.md#0"]);
    expect(results[0].metadata.engine).toBe("chunk-v3");
    expect(client.embedQuery).toHaveBeenCalledWith("query");
  });

  it("falls back to lexical only while the index is still building", async () => {
    const lexical = [lexicalDoc("a.md#0", "a.md", "lexical a")];
    const lexicalRetriever = {
      getRelevantDocuments: jest.fn(async () => lexical),
    } as unknown as DocumentRetriever;
    const index = {
      waitForReady: jest.fn(async () => false),
      search: jest.fn(),
    } as unknown as LocalEmbeddingIndex;
    const client = { embedQuery: jest.fn() } as unknown as LocalEmbeddingClient;

    const retriever = new HybridRetriever(lexicalRetriever, index, client, makeApp(["a.md"]), 5);
    const results = await retriever.getRelevantDocuments("query");

    expect(results).toHaveLength(1);
    expect(results[0].metadata.chunkId).toBe("a.md#0");
    expect(client.embedQuery).not.toHaveBeenCalled();
  });

  it("returns lexical results when the semantic leg fails", async () => {
    const lexical = [lexicalDoc("a.md#0", "a.md", "lexical a")];
    const lexicalRetriever = {
      getRelevantDocuments: jest.fn(async () => lexical),
    } as unknown as DocumentRetriever;
    const index = {
      waitForReady: jest.fn(async () => true),
      search: jest.fn(() => [{ chunkId: "a.md#0", notePath: "a.md", score: 0.9 }]),
    } as unknown as LocalEmbeddingIndex;
    const client = {
      embedQuery: jest.fn(async () => {
        throw new Error("server down");
      }),
    } as unknown as LocalEmbeddingClient;
    jest.mocked(getSharedChunkManager).mockReturnValue({
      getChunkText: jest.fn(async () => "text"),
    } as never);

    const retriever = new HybridRetriever(lexicalRetriever, index, client, makeApp(["a.md"]), 5);
    const results = await retriever.getRelevantDocuments("query");

    expect(results.map((doc) => String(doc.metadata.chunkId))).toEqual(["a.md#0"]);
  });

  it("drops semantic hits below the minimum similarity", async () => {
    const lexical: Document[] = [];
    const lexicalRetriever = {
      getRelevantDocuments: jest.fn(async () => lexical),
    } as unknown as DocumentRetriever;
    const index = {
      waitForReady: jest.fn(async () => true),
      search: jest.fn(() => [{ chunkId: "note.md#0", notePath: "note.md", score: 0.05 }]),
    } as unknown as LocalEmbeddingIndex;
    const client = {
      embedQuery: jest.fn(async () => new Float32Array([1, 0])),
    } as unknown as LocalEmbeddingClient;

    const retriever = new HybridRetriever(lexicalRetriever, index, client, makeApp(["note.md"]), 5);
    const results = await retriever.getRelevantDocuments("query");

    expect(results).toHaveLength(0);
  });
});
